import { test, expect, watchPage, refused, IS_PROD } from "../guard";
import fs from "node:fs";

/**
 * Visit every page a user can reach by clicking links, starting from every sidebar section. Each
 * distinct page shape (ids collapsed, e.g. /clients/:id?tab=billing) is opened up to PER_SHAPE times.
 * A page passes when it answers < 400, renders a heading, shows no error page or the app's "This
 * page couldn't load", and logs no page errors or 5xx. Links to files (PDFs, CSV exports) are fetched
 * and checked for the right kind of file. New pages are picked up without changing this test.
 */
const START = ["/", "/tasks", "/inbox", "/clients", "/policies", "/renewals", "/sales", "/certificates", "/claims", "/accounting", "/reports", "/admin",
  "/tasks/new", "/clients/new", "/policies/new", "/certificates/new", "/claims/new", "/sales/new", "/inbox/simulate", "/search?q=insurance"];
const PER_SHAPE = Number(process.env.UAT_PER_SHAPE ?? 2);
const MAX_PAGES = Number(process.env.UAT_MAX_PAGES ?? 320);
const FILE = /^\/(documents\/(render$|\d+$)|reports\/csv$|accounting\/export$)/;
const KEEP_VALUE = new Set(["tab", "status", "view", "action", "kind", "r", "sample", "show", "scope", "due"]);
const DROP = new Set(["msg", "error"]);
// A role that may not open a page gets a plain panel, not a heading. On a low-privilege login that's a pass.
const ROLE_REFUSAL = /You can.t open|Accounting is available to|Only administrators can view/;

function shape(path: string): string {
  const u = new URL(path, "http://x");
  const p = u.pathname.split("/").map((s) => (/^\d+$/.test(s) ? ":id" : s)).join("/");
  const keys = [...u.searchParams.keys()].sort().map((k) => (KEEP_VALUE.has(k) ? `${k}=${u.searchParams.get(k)}` : k)).join("&");
  return keys ? `${p}?${keys}` : p;
}

function clean(u: URL): string {
  const q = new URLSearchParams([...u.searchParams].filter(([k]) => !DROP.has(k))).toString();
  return u.pathname + (q ? `?${q}` : "");
}

test("crawl every reachable page", async ({ page, api, baseURL }) => {
  test.setTimeout(30 * 60_000);
  const origin = new URL(baseURL!).origin;
  const queue = [...START];
  const seenUrl = new Set<string>();
  const perShape = new Map<string, number>();
  const results: { url: string; shape: string; status: number; ms: number; heading: string; restricted: boolean; problems: string[] }[] = [];
  const files: { url: string; status: number; type: string; bytes: number; ok: boolean }[] = [];
  const skipped: { url: string; why: string }[] = [];
  const failures: string[] = [];

  while (queue.length && results.length < MAX_PAGES) {
    const path = queue.shift()!;
    if (seenUrl.has(path)) continue;
    seenUrl.add(path);
    const why = refused(path);
    if (why) { skipped.push({ url: path, why }); continue; }
    const sh = shape(path);
    if ((perShape.get(sh) ?? 0) >= PER_SHAPE) continue;
    perShape.set(sh, (perShape.get(sh) ?? 0) + 1);

    if (FILE.test(new URL(path, "http://x").pathname)) {
      const res = await api.get(path, { maxRedirects: 0 });
      const body = await res.body();
      const type = res.headers()["content-type"] ?? "";
      const text = body.subarray(0, 200).toString();
      let ok = res.status() === 200 && body.length > 0;
      if (path.startsWith("/documents/render")) ok &&= type.includes("pdf") && text.startsWith("%PDF");
      else if (type.includes("pdf")) ok &&= text.startsWith("%PDF");
      if (path.startsWith("/reports/csv")) ok &&= type.includes("text/csv");
      if (path.startsWith("/accounting/export")) ok &&= path.includes("kind=iif") ? text.startsWith("!TRNS") : type.includes("text/csv");
      files.push({ url: path, status: res.status(), type, bytes: body.length, ok });
      if (!ok) failures.push(`file ${path}: HTTP ${res.status()}, ${type}, ${body.length} bytes, starts "${text.slice(0, 40)}"`);
      continue;
    }

    const problems = watchPage(page);
    const t0 = Date.now();
    const resp = await page.goto(path, { waitUntil: "domcontentloaded" }).catch((e) => { problems.push(`navigation failed: ${(e as Error).message.split("\n")[0]}`); return null; });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    const status = resp?.status() ?? 0;
    const heading = (await page.locator("h1").first().textContent({ timeout: 2_000 }).catch(() => ""))?.trim() ?? "";
    const body = await page.locator("body").innerText().catch(() => "");
    const restricted = ROLE_REFUSAL.test(body);
    if (status >= 400 || status === 0) problems.push(`HTTP ${status}`);
    if (/This page couldn.t load|Application error|Internal Server Error|This page could not be found/i.test(body)) problems.push("error page shown");
    if (!heading && !restricted) problems.push("no heading");
    results.push({ url: path, shape: sh, status, ms: Date.now() - t0, heading, restricted, problems: [...problems] });
    if (problems.length) failures.push(`${path}: ${problems.join("; ")}`);
    page.removeAllListeners("pageerror"); page.removeAllListeners("response");

    // Opening a restricted document writes an audit row by design, so the crawl stays off them:
    // they're marked on a client's Documents tab, and a policy's Documents tab doesn't mark them.
    const onPolicy = new URL(path, "http://x").pathname.startsWith("/policies/");
    const links = await page.$$eval("a[href]", (as) => as.map((a) => {
      const el = a as HTMLAnchorElement;
      return { href: el.href, restricted: /\brestricted\b/i.test(el.closest("li, tr")?.textContent ?? "") };
    })).catch(() => [] as { href: string; restricted: boolean }[]);
    for (const l of links) {
      let u: URL;
      try { u = new URL(l.href); } catch { continue; }
      if (u.origin !== origin) continue;
      if (/^\/(signout|signin|_next|api\/)/.test(u.pathname)) continue;   // the API has its own spec
      if (/^\/documents\/\d+$/.test(u.pathname) && (l.restricted || onPolicy)) continue;
      const next = clean(u);
      if (!seenUrl.has(next)) queue.push(next);
    }
  }

  fs.mkdirSync(".work", { recursive: true });
  fs.writeFileSync(`.work/crawl-${process.env.UAT_PASS_NAME ?? "readonly"}.json`, JSON.stringify({ pages: results, files, failures, skipped }, null, 2));
  test.info().annotations.push({ type: "coverage", description: `${results.length} pages across ${perShape.size} page shapes, ${files.length} files${IS_PROD ? " (production)" : ""}` });
  const slow = results.filter((r) => r.ms > 8_000).map((r) => `${r.url} ${r.ms}ms`);
  if (slow.length) test.info().annotations.push({ type: "slow pages", description: slow.join(", ") });
  expect(results.length, "pages visited").toBeGreaterThan(40);
  expect(files.some((f) => f.type.includes("pdf")), "a PDF was checked").toBe(true);
  if (!IS_PROD) expect(files.some((f) => f.type.includes("csv")), "a CSV export was checked").toBe(true);
  expect(failures, "pages or files that failed").toEqual([]);
});
