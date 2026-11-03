import { test as base, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// The sandbox (writing) suite. Runs only against the local siryous-ams-uat stack: playwright.config.ts
// and the check below refuse anything else. Flows build on each other, in file order, sharing records
// through .work/sandbox-state.json. Assertions state what a user should see: when the app misbehaves
// the test fails, on purpose.

const BASE = process.env.UAT_BASE_URL ?? "http://127.0.0.1:3950";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(BASE)) throw new Error(`The sandbox suite only runs against a local sandbox, not ${BASE}`);

// Sandbox-only passwords, set in uat/docker-compose.uat.yml. They protect nothing real.
export const LOGINS = {
  admin: "uat-sb-admin", choll: "uat-sb-choll", mrivera: "uat-sb-mrivera", lmorgan: "uat-sb-lmorgan",
  kowens: "uat-sb-kowens", rcallahan: "uat-sb-rcallahan", uatnew: "uat-sb-uatnew", autoprov: "uat-sb-autoprov",
} as const;
export type Who = keyof typeof LOGINS;
export const FULL_NAME: Partial<Record<Who, string>> = { admin: "Morgan Ellis", choll: "Catherine Holloway", mrivera: "Marisol Rivera", lmorgan: "Lisa Morgan", kowens: "Kayla Owens", rcallahan: "Ryan Callahan" };
export const DOMAIN = "inbox.siryous.local";
export const INBOUND_TOKEN = "uat-inbound-token";
export const CRON_TOKEN = "uat-cron-token";
export const basic = (who: Who) => "Basic " + Buffer.from(`${who}:${LOGINS[who]}`).toString("base64");

const STATE = ".work/sandbox-state.json";

export function readState(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; }
}
export function saveState(patch: Record<string, string | number>) {
  fs.mkdirSync(".work", { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ ...readState(), ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])) }, null, 2));
}
/** A record an earlier flow made; this test skips if that flow didn't get that far. */
export function need(key: string): string {
  const v = readState()[key];
  if (!v) base.skip(true, `needs ${key} from an earlier flow, which did not complete`);
  return v!;
}

/** A tag fixed for the whole run (see playwright.config.ts), for records that later tests look up. */
export const T = process.env.UAT_TAG ?? "local";
/** A short tag unique to this call. */
export const tag = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).slice(-7);
export const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
export function addDays(iso: string, days: number) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

// ───── the database, for picking seeded records to work on and for checks a user can't see

const ROOT = process.env.UAT_ROOT ?? path.resolve(process.cwd(), "..");
/** Rows of a query in the sandbox database, each row an array of strings. */
export function sql(query: string): string[][] {
  const out = execFileSync("docker", ["compose", "-p", "siryous-ams-uat", "--project-directory", ROOT, "-f", path.join(ROOT, "docker-compose.yml"), "-f", path.join(ROOT, "uat/docker-compose.uat.yml"),
    "exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "ams", "-d", "ams", "-tA", "-F", "\t", "-c", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.split("\n").filter((l) => l.length).map((l) => l.split("\t"));
}
/** The first value of the first row. */
export function val(query: string): string { return sql(query)[0]?.[0] ?? ""; }

// ───── pages

async function signInOn(page: Page, who: Who) {
  await page.goto("/signin");
  await page.getByLabel("User ID").fill(who);
  await page.getByLabel("Password").fill(LOGINS[who]);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signin"));
}

/** A fresh browser for one person. Pages report page errors and 5xx into `problems`; confirm dialogs are accepted. */
async function openBrowser(browser: Browser, baseURL: string, problems: string[], opts: { storageState?: string } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ baseURL, timezoneId: "America/New_York", acceptDownloads: true, serviceWorkers: "block", ...opts });
  // Another system's review reports live under this path: never opened, not even by a link prefetch.
  // And a flow never leaves the sandbox: a bad redirect fails here instead of landing on whatever else runs on this machine.
  const origin = new URL(baseURL).origin;
  await ctx.route("**/*", (r) => {
    const u = new URL(r.request().url());
    return u.origin !== origin || /^\/admin\/app-tests(\/|$)/.test(u.pathname) ? r.abort("blockedbyclient") : r.continue();
  });
  ctx.on("page", (page) => {
    page.on("pageerror", (e) => {
      // React #418 (a hydration mismatch) comes and goes on the app's largest pages, whatever the flow
      // is doing. The crawl in tests/readonly fails on it; here it's noted so it can't mask a flow's own result.
      if (/Minified React error #418/.test(e.message)) { fs.appendFileSync(".work/hydration-sandbox.log", `${new Date().toISOString()} ${page.url()}\n`); return; }
      problems.push(`page error on ${page.url()}: ${e.message}`);
    });
    page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
    page.on("dialog", (d) => d.accept());
  });
  return ctx;
}

export const test = base.extend<{ problems: string[]; as: (who: Who) => Promise<Page>; signedOut: () => Promise<Page>; anon: APIRequestContext; apiAs: (who: Who) => Promise<APIRequestContext> }>({
  // Any page error or 5xx during a flow fails it, like a user seeing a broken page would.
  problems: [async ({}, use) => {
    const problems: string[] = [];
    await use(problems);
    expect(problems, "page errors or server errors during the flow").toEqual([]);
  }, { auto: true }],
  /** A page signed in as this person through the real form (once per login, then the saved session). */
  as: async ({ browser, baseURL, problems }, use) => {
    const open: BrowserContext[] = [];
    await use(async (who) => {
      const saved = `.work/auth-${who}.json`;
      if (!fs.existsSync(saved)) {
        const ctx = await openBrowser(browser, baseURL!, problems);
        const page = await ctx.newPage();
        await signInOn(page, who);
        await ctx.storageState({ path: saved });
        await ctx.close();
      }
      const ctx = await openBrowser(browser, baseURL!, problems, { storageState: saved });
      open.push(ctx);
      return ctx.newPage();
    });
    for (const c of open) await c.close().catch(() => {});
  },
  /** A page in a browser with no session. */
  signedOut: async ({ browser, baseURL, problems }, use) => {
    const open: BrowserContext[] = [];
    await use(async () => {
      const ctx = await openBrowser(browser, baseURL!, problems);
      open.push(ctx);
      return ctx.newPage();
    });
    for (const c of open) await c.close().catch(() => {});
  },
  /** An API client with no login at all. */
  anon: async ({ playwright, baseURL }, use) => {
    const ctx = await playwright.request.newContext({ baseURL });
    await use(ctx);
    await ctx.dispose();
  },
  /** An API client using this person's HTTP Basic login. */
  apiAs: async ({ playwright, baseURL }, use) => {
    const open: APIRequestContext[] = [];
    await use(async (who) => {
      const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Authorization: basic(who) } });
      open.push(ctx);
      return ctx;
    });
    for (const c of open) await c.dispose();
  },
});

export { expect };
export type { Page };

/** The green banner a server action leaves after it redirects. */
export async function expectFlash(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}
/** The red banner. */
export async function expectError(page: Page, text: string | RegExp) {
  await expect(page.locator('[role="alert"]').filter({ hasText: text }).first()).toBeVisible();
}
/** A form control by its field name; `within` narrows it when a page repeats the name. */
export const field = (page: Page, name: string) => page.locator(`:is(input, select, textarea)[name="${name}"]`);
/** Choose a client in the search box: type the name, take the row with that client's code (names can repeat). */
export async function pickClient(page: Page, id: string | number) {
  const [name, code] = sql(`SELECT name, code FROM clients WHERE id = ${Number(id)}`)[0];
  await page.getByRole("combobox", { name: "Client" }).fill(name);
  await page.getByRole("option").filter({ hasText: code }).click();
}
/** The number at the end of a URL path like /tasks/123. */
export function idFrom(url: string, after: string): string {
  const m = new URL(url, "http://x").pathname.match(new RegExp(`/${after}/(\\d+)`));
  if (!m) throw new Error(`no ${after} id in ${url}`);
  return m[1];
}
/** Fetch a link with this page's session. */
export async function get(page: Page, href: string) { return page.request.get(href); }
export async function expectPdf(page: Page, href: string) {
  const res = await page.request.get(href);
  expect(res.status(), href).toBe(200);
  expect(res.headers()["content-type"], href).toContain("pdf");
  const body = await res.body();
  expect(body.subarray(0, 4).toString(), href).toBe("%PDF");
  expect(body.length, href).toBeGreaterThan(500);
}
/** Create a task through the real form. Returns its id. */
export async function newTask(page: Page, subject: string, o: { due?: string; priority?: string; code?: string; owner?: string; client?: string } = {}): Promise<string> {
  await page.goto(`/tasks/new${o.client ? `?client=${o.client}` : ""}`);
  if (o.code) await field(page, "code").selectOption(o.code);
  await field(page, "subject").fill(subject);
  if (o.owner) await field(page, "owner_id").selectOption({ label: o.owner });
  if (o.priority) await field(page, "priority").selectOption(o.priority);
  if (o.due) await field(page, "due_date").fill(o.due);
  await page.getByRole("button", { name: "Create task" }).click();
  await expectFlash(page, "Task created");
  return idFrom(page.url(), "tasks");
}
