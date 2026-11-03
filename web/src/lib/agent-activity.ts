// Server side of Admin > App Tests: find the review agents' reports and the ledger, read them, and hand
// the parsed result to the page. Reads on every request, so the page is as current as the files. In a
// checkout that is docs/agent-reports, rewritten by every run; on Fly it is the copy scripts/fly-deploy.sh
// bakes into the image. The UAT sandbox sets AGENT_REPORTS_DIR to nothing, so the page is empty there and
// no agent can read another's report through the app.

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { activityView, readLedger, type ActivityView } from "./agent-ledger";
import { AGENTS, parseReport, type AgentKey, type ParsedReport } from "./agent-reports";
import { DISPLAY_TIME_ZONE } from "./time";

export function reportsDir(): string {
  if (process.env.AGENT_REPORTS_DIR) return process.env.AGENT_REPORTS_DIR;
  const docs = path.resolve(process.cwd(), "..", "docs", "agent-reports");
  return existsSync(docs) ? docs : path.join(process.cwd(), "agent-reports");
}

type FileRead = { text: string; mtime: Date };

async function readOptional(file: string): Promise<FileRead | null> {
  try {
    const [text, s] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    return { text, mtime: s.mtime };
  } catch {
    return null;
  }
}

export type AgentActivity = { view: ActivityView; written: Partial<Record<AgentKey, Date>>; ledgerUpdatedAt: string | null; source: "checkout" | "deployed copy" };

export async function loadAgentActivity(): Promise<AgentActivity> {
  const dir = reportsDir();
  const [ledgerFile, ...files] = await Promise.all([
    readOptional(path.join(dir, "AGENT_LEDGER.json")),
    ...AGENTS.map((a) => readOptional(path.join(dir, a.file))),
  ]);
  const reports: Partial<Record<AgentKey, ParsedReport>> = {};
  const written: Partial<Record<AgentKey, Date>> = {};
  AGENTS.forEach((a, i) => {
    const f = files[i];
    if (!f) return;
    reports[a.key] = parseReport(a.key, f.text, DISPLAY_TIME_ZONE);
    written[a.key] = f.mtime;
  });
  const ledger = readLedger(ledgerFile?.text ?? null);
  return { view: activityView(ledger, reports), written, ledgerUpdatedAt: ledger.updatedAt, source: dir.includes(`${path.sep}docs${path.sep}`) ? "checkout" : "deployed copy" };
}

/** One agent's latest report as it wrote it, with any absolute path shortened to a repository path. */
export async function readReport(agent: AgentKey): Promise<FileRead | null> {
  const info = AGENTS.find((a) => a.key === agent);
  if (!info) return null;
  const f = await readOptional(path.join(reportsDir(), info.file));
  return f && { text: f.text.replace(/\/(?:Users|home|private)\/[^\s`'"]*?\.review\/(?:code|security|ux|uat)\//g, ""), mtime: f.mtime };
}

/** A UX before/after mockup, or null. The strict id keeps this inside the mockups folder. */
export async function readMockup(id: string): Promise<string | null> {
  if (!/^UX-\d{3,4}$/.test(id)) return null;
  return (await readOptional(path.join(reportsDir(), "ux", "mockups", `${id}.html`)))?.text ?? null;
}

/** Which UX findings have a mockup on file. */
export async function mockupIds(): Promise<Set<string>> {
  try {
    return new Set((await readdir(path.join(reportsDir(), "ux", "mockups"))).filter((f) => /^UX-\d{3,4}\.html$/.test(f)).map((f) => f.replace(/\.html$/, "")));
  } catch {
    return new Set();
  }
}
