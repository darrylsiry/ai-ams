import { test as base, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";

/**
 * The read-only fixture: every test under tests/readonly uses `test` from here.
 *
 * Production safety is enforced in three layers, so no single mistake in a test can write:
 *  1. The browser: every request leaving the page goes through `context.route`. GET, HEAD and
 *     OPTIONS pass. Anything else is aborted before it leaves the machine and logged as a "blocked
 *     write". This app has no POST that only reads, so there is no allow-list. Next server actions
 *     are POSTs with a next-action header and land here.
 *  2. The API client: the `api` and `anon` fixtures only have get(). The raw `request`, `page.request`
 *     and `context.request` objects, which bypass routing, throw on any non-GET call.
 *  3. scripts/uat.sh refuses to start the read-only suite if a spec file calls post/put/patch/delete/
 *     fetch directly.
 * Signing in: an Authorization: Basic header on every request (web/src/middleware.ts accepts it), so
 * the sign-in form is never submitted in read-only mode.
 *
 * Also refused here:
 *  - Any URL under /admin/app-tests, in every pass and for every method, Next link prefetches
 *    included: another system's review reports live there and this suite stays independent of them.
 *  - Any request to another host, so the Authorization header can't leave the site under test.
 *  - GETs that write, on production only (see WRITING_GETS).
 */

export const USER = process.env.UAT_USER ?? "admin";
const PASS = process.env.UAT_PASS ?? "uat-sb-admin";
export const AUTH = "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64");
export const IS_PROD = !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(process.env.UAT_BASE_URL ?? "http://127.0.0.1:3950");
const BLOCKED_LOG = `.work/blocked-${process.env.UAT_PASS_NAME ?? "readonly"}.jsonl`;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const NEVER_OPEN = /^\/admin\/app-tests(\/|$)/;

/**
 * GETs that write, or did. The write guard can't catch these by method:
 *   /reports/csv        adds an audit_events row (report.exported), on purpose: downloads are audited
 *   /accounting/export  changes nothing in current code; a build deployed before that fix stamps ledger_entries
 * Refused on production so a read-only pass can't touch live data. The canary still opens them, and its
 * fingerprint leaves out report.exported rows alone, so any other write is still reported.
 */
const WRITING_GETS = /^\/(reports\/csv|accounting\/export)(\/|$)/;

/** Why this path may not be opened in this pass, or null when it may. */
export function refused(path: string): string | null {
  const p = new URL(path, "http://x").pathname;
  if (NEVER_OPEN.test(p)) return "never opened in any pass";
  if (IS_PROD && WRITING_GETS.test(p)) return "a GET that writes, refused on production";
  return null;
}

export type Blocked = { method: string; url: string; action: string | null; test: string; at: string };

function logBlocked(entry: Blocked) {
  fs.mkdirSync(".work", { recursive: true });
  fs.appendFileSync(BLOCKED_LOG, JSON.stringify(entry) + "\n");
}

async function guardContext(context: BrowserContext, origin: string, blocked: Blocked[], testTitle: string) {
  await context.route("**/*", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin !== origin) return route.abort("blockedbyclient");
    const why = refused(u.pathname);
    if (why || !SAFE_METHODS.has(req.method())) {
      const entry: Blocked = { method: req.method(), url: req.url(), action: req.headers()["next-action"] ?? null, test: testTitle, at: new Date().toISOString() };
      if (!why) blocked.push(entry);
      logBlocked(entry);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  // Close the side doors: this client does not go through context.route.
  lockToGet(context.request, "context.request");
}

function lockToGet(client: APIRequestContext, name: string) {
  for (const m of ["post", "put", "patch", "delete"] as const) {
    (client as unknown as Record<string, unknown>)[m] = () => { throw new Error(`UAT read-only mode: ${name}.${m}() is not allowed`); };
  }
  const fetchFn = client.fetch.bind(client);
  (client as unknown as Record<string, unknown>).fetch = (url: string, opts?: { method?: string }) => {
    const method = (opts?.method ?? "GET").toUpperCase();
    if (!SAFE_METHODS.has(method)) throw new Error(`UAT read-only mode: ${name}.fetch(${method}) is not allowed`);
    return fetchFn(url, opts);
  };
}

export type SafeApi = { get: APIRequestContext["get"] };

function safeApi(ctx: APIRequestContext): SafeApi {
  return {
    get: (url, opts) => {
      const why = refused(url);
      if (why) throw new Error(`UAT read-only mode: GET ${url} refused: ${why}`);
      return ctx.get(url, opts);
    },
  };
}

export const test = base.extend<{ blocked: Blocked[]; api: SafeApi; anon: SafeApi }>({
  extraHTTPHeaders: [{ Authorization: AUTH }, { option: true }] as never,   // still an option, so @public tests can turn it off
  blocked: async ({}, use) => use([]),
  context: async ({ context, baseURL, blocked }, use, info) => {
    await guardContext(context, new URL(baseURL!).origin, blocked, info.titlePath.slice(1).join(" › "));
    await use(context);
  },
  page: async ({ page }, use) => {
    lockToGet(page.request, "page.request");
    await use(page);
  },
  request: async ({ request }, use) => {
    lockToGet(request, "request");
    await use(request);
  },
  api: async ({ playwright, baseURL }, use) => {
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Authorization: AUTH } });
    await use(safeApi(ctx));
    await ctx.dispose();
  },
  anon: async ({ playwright, baseURL }, use) => {
    const ctx = await playwright.request.newContext({ baseURL });
    await use(safeApi(ctx));
    await ctx.dispose();
  },
});

export { expect };

const HYDRATION = /Minified React error #41[89]|Hydration failed|hydration mismatch/i;
let hydrationSeq = 0;

/**
 * UAT-F14: React #418 comes and goes, and the production build's message names no element. When it
 * appears, keep what's needed to find the node: the HTML the server sent, the page as the browser ended
 * up, and the recent console. Written to .work/hydration-<pass>/<n>-{server.html,dom.html,info.json}.
 * The live login's Authorization header is never written; the pages hold only what the login could see.
 */
function captureHydration(page: Page, message: string, serverHtml: Promise<string> | null, consoleTail: string[]) {
  const url = page.url();
  const dom = page.content().catch(() => "(not available)");   // asked for at once, before the test moves on
  const dir = `.work/hydration-${process.env.UAT_PASS_NAME ?? "readonly"}`;
  const n = String(++hydrationSeq).padStart(3, "0");
  void (async () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${dir}/${n}-info.json`, JSON.stringify({ at: new Date().toISOString(), url, message, console: consoleTail }, null, 1));
      fs.writeFileSync(`${dir}/${n}-dom.html`, await dom);
      fs.writeFileSync(`${dir}/${n}-server.html`, (await serverHtml?.catch(() => "")) || "(not available)");
    } catch { /* evidence is best effort; the failure itself is still reported */ }
  })();
}

const captured = new WeakSet<Page>();

/** Once per tab, however often watchPage is called on it: keep the latest server HTML and console, capture on a hydration error. */
function watchHydration(page: Page) {
  if (captured.has(page)) return;
  captured.add(page);
  const consoleTail: string[] = [];
  let serverHtml: Promise<string> | null = null;
  page.on("console", (m) => { consoleTail.push(`${m.type()}: ${m.text().slice(0, 2000)}`); if (consoleTail.length > 30) consoleTail.shift(); });
  page.on("response", (r) => {
    const req = r.request();
    if (req.isNavigationRequest() && req.resourceType() === "document" && req.frame() === page.mainFrame()) serverHtml = r.text();
  });
  page.on("pageerror", (e) => { if (HYDRATION.test(e.message)) captureHydration(page, e.message, serverHtml, [...consoleTail]); });
}

/** Collect page errors and 5xx responses from this page from now on; a hydration error is also captured. */
export function watchPage(page: Page): string[] {
  const problems: string[] = [];
  watchHydration(page);
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
  return problems;
}
