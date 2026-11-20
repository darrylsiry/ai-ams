# UAT report: siryous AMS

Run: 2026-11-09 19:09 · code d7534221 · live site https://siryous-ams.fly.dev

## Verdict
Mostly yes. All 182 sandbox flows passed, the live site passed its read-only checks, and no data changed during the canary pass. However, the overall run is FAIL because an intermittent React hydration error is back (UAT-F14). It failed the canary crawl on `/inbox?tab=all`. It also failed the first production crawl on `/claims?status=all&page=1`, which passed on the automatic retry.

## Summary
| Pass | What it covers | Passed | Failed | Skipped | Result |
|------|----------------|--------|--------|---------|--------|
| Sandbox flows | every function end to end, writes included, on a disposable copy | 182 | 0 | 0 | PASS |
| Canary | the read-only suite on the sandbox, data compared before and after | 16 | 1 | 0 | FAIL |
| Production | pages, downloads and API reads on the live site, writes blocked | 14 (+1 flaky, passed on retry) | 0 | 2 | PASS (flaky) |

## Production safety
- **Writes stopped by the guard on the live site: 4.** Each came from a dry-run test clicking a real button:
  - POST `/certificates/new?client=162` (Issue certificate)
  - POST `/clients/new` (Save client)
  - POST `/tasks/new` (Create task)
  - POST `/signout` (Sign out from the header)
- **GETs the guard refused: 2.** Both were `/admin/app-tests?_rsc=…`, a link prefetch of a page no pass may open. There was one per crawl attempt, because the crawl ran twice on production (retry). Nothing was written, and no page tried to write just by being opened.
- **Canary:** no table changed. `canary.diff` is empty, and the before and after fingerprints have 46 lines each.
  - On the sandbox the guard stopped 6 dry-run writes: complete task, issue certificate, post receipt, save client, create task, sign out.
  - It also refused 1 GET to `/admin/app-tests`.
- **Login used on production:** `uat`. Its role is `readonly`, so 10 pages showed the "no access" panel (see UAT-O3).
- **Limit of this evidence:**
  - The data comparison runs only on the sandbox.
  - Page-view writes the guard can't stop (`users.last_active_at`, and the daily automation on the first view of the day) could also happen on the live site. This pass cannot check that.

## Failures

### UAT-F14 Pages intermittently throw a React hydration error (App defect)
- **Where:**
  - Canary: `/inbox?tab=all` on the sandbox.
  - Production, first crawl attempt: `/claims?status=all&page=1`.
- **What a user sees:**
  - React logs "Minified React error #418 (HTML)": the HTML the server sent did not match what the browser rendered.
  - React then throws away the server HTML and re-renders on the client. The page still shows, but it may flash or briefly show different content. The page shows nothing wrong in the browser.
  - This failed before, then passed last run, and is back now.
- **Evidence:**
  - `uat/.work/crawl-canary.json` records the error on `/inbox?tab=all`, page error "Minified React error #418; …args[]=HTML&args[]=".
  - In the same canary crawl, pages showing the same list passed: `/inbox?tab=all&scope=all`, `/inbox?scope=all&tab=all` and `/inbox?tab=all&page=1`. The admin's default scope is already "all".
  - On production, `run-prod.log:35` shows the same error on `/claims?status=all&page=1`. The retry opened that same URL cleanly (`crawl-prod.json`, 0 problems).
  - Screenshots, which show the last page crawled rather than the failing one: `uat/.work/artifacts-canary/03-crawl-crawl-every-reachable-page/test-failed-1.png` and `uat/.work/artifacts-prod/03-crawl-crawl-every-reachable-page/test-failed-1.png`.
- **Likely cause:** not found.
  - Both pages are server components and render dates only on the server (`inbox/page.tsx:69`, `whenShort`).
  - I searched the client components (`components/shell.tsx`, `subnav.tsx`, `global-search.tsx`, `ask-box.tsx`). None of them reads `Date`, `toLocale*`, `Math.random` or `window` while rendering.
  - The error moves between pages and does not repeat on identical URLs. That points to something time- or timing-dependent shared across pages, not to these two pages. `global-search.tsx:7` (`useSearchParams` in the shell) is a candidate worth checking.
- **Suggested fix:**
  - Reproduce with a development build, which prints the full message, including the element that differed.
  - Have `watchPage` in `uat/tests/guard.ts` save `page.content()` and the console messages when a #418 appears. The report could then name the node.
  - Note that the production retry (`playwright.config.ts:25`, `retries: isProd ? 1 : 0`) turns this into "flaky" with exit 0. A real intermittent defect can therefore pass the live run unnoticed.

## Observations

### UAT-O3 The production login can't see Accounting or user admin (Observation)
- **Where:** production pass, `uat` login (`readonly` role, `web/src/lib/permissions.ts:21` grants it nothing).
- **What happens:**
  - **Pages that showed the "no access" panel (10):** `/accounting`, `/inbox/simulate`, `/reports/renewals`, `/reports/users`, `/admin/users`, `/admin/audit`, `/admin/system`, `/admin/settings`, `/admin/carriers` and the new `/admin/assistant`.
  - **Change since last run:** `/admin/settings` and `/admin/carriers` rendered for this login last time and now refuse it. That looks like a deliberate tightening, but it shrinks live coverage further.
  - **Dry runs skipped (2):** "complete a task" and "post a receipt".
- **Suggestion:** Give `readonly` the view permissions (`reports.all`, `accounting.view`) but no write permission, so the live pass covers those pages. Alternatively, add a production-only view role for `uat`.

### UAT-O6 The live site's build can't be confirmed (Observation)
- **Where:** production pass.
- **What happens:**
  - `web/src/app/api/live/route.ts` still returns only `{ ok: true }`.
  - The live site does serve `/assistant` and `/assistant/about`, so it is a recent build. I cannot say whether it is d7534221.
- **Suggestion:** Expose the commit on `/api/live` or `/api/health`, and record it in the prod pass.

### UAT-O9 The canary crawl stopped at its 320-page cap (Observation)
- **Where:** `uat/tests/readonly/03-crawl.spec.ts:14` and `:44`, canary pass.
- **What happens:**
  - The crawl opened exactly 320 pages again, across 223 page shapes, down from 240. The last page opened was a renewals pagination variant.
  - **Unknown remainder:** the queue isn't saved, so I can't tell what was never opened.
  - **Where the cap went:** many slots go to the same URL with its query keys in a different order, such as `/inbox?tab=all&scope=mine` and `/inbox?scope=mine&tab=all`. Others go to page-number variants (48 of them).
  - **Production:** its crawl ended at 201 pages, under the cap.
- **Suggestion:**
  - Normalise the order of query keys in `clean()` before adding a URL to the queue.
  - Record the length of the remaining queue in `crawl-<pass>.json`, and flag it when the cap is hit.
  - Raise `UAT_MAX_PAGES`.

### UAT-O10 A read-only login is offered write forms the server should refuse (Observation)
- **Where:** `/clients/new`, `/certificates/new` and `/tasks/new`, as the `uat` login on the live site.
- **What happens:**
  - All three forms rendered again, and their buttons sent a POST that the guard stopped.
  - `web/src/app/(app)/clients/new/page.tsx` still has no permission check. The server actions refuse the save, so this is a dead end for the user, not a security hole.
  - I read this from the source and did not see a refusal run.
- **Suggestion:** Show the role-refusal panel on these pages for logins without `write`, and add a sandbox flow that submits one as `readonly`.

## Resolved since last run
None. UAT-F14 was listed as resolved last run and has come back (see Failures).

## Coverage
- **Sandbox:** 182 flows across 14 spec files, with writes included.
  - Two spec files are new since last run:
    - `05-request-access` (4 flows): request form, validation, honeypot, flood limit, admin listing.
    - `66-assistant` (10 flows): the AI Assistant with no API key, request refusals, each role's view, admin usage page, and the My Day layout on desktop and phone.
  - The sandbox built from this snapshot and seeded 414 clients.
- **Canary:**
  - **Crawl:** 320 pages and 31 files, at the cap (UAT-O9).
  - **Dry runs:** 6 writes caught.
  - **Data:** no table changed.
- **Production:**
  - **Crawl:** 201 pages across 138 page shapes, from the retry attempt. Every page answered 200; the average page took 1.18 s and the slowest 3.1 s.
  - **Files:** 4 PDFs fetched and valid (2 rendered certificates and 2 stored documents).
  - **Signed-out and API checks:** all passed (liveness, sign-in, return-to, API refusals, health, webhook GET, quote form, sign-out page).
  - **Dry runs:** 4 caught and 2 skipped (UAT-O3).
- **Not covered:**
  - **On production:**
    - CSV and accounting exports (the guard refuses them because they can write).
    - The 10 refused pages (UAT-O3).
    - `/request-access`: the crawl skips links from `/signin`, and no public check opens it.
  - **Real SMTP sending and real AI calls:** the sandbox has neither SMTP_URL nor an API key, by design.
  - **`/admin/app-tests`:** no pass opens it, by design.
- **Limits on my side:**
  - I did not rerun the canary to recheck UAT-F14. The production retry and the identical inbox URLs that passed are the evidence that it is intermittent.
  - The review guard refused some of my shell commands, such as writing a log file and jq paths containing `..`. I worked from `uat/.work/` instead.
  - Sandbox removal rests on the harness's own summary line.

## Functions checked
| Area | Function | Sandbox | Production |
|------|----------|---------|------------|
| System | liveness, health with the database up | PASS | PASS |
| API security | no-login refusal, wrong password refused, GET-only clients, cron token | PASS | PASS (no cron check) |
| Sign-in | sign-in form, return-to, sign-out page, header sign-out | PASS | PASS (header sign-out caught by the guard) |
| Request access | request form, validation, honeypot, flood limit, admin list | PASS | not covered |
| My Day and tasks | queue, complete, reassign, create, layout | PASS | pages PASS; create caught by the guard; complete skipped (O3) |
| Email intake | webhook, senders, rules, forwards, inbox | PASS | webhook GET and inbox pages PASS; simulate refused for `uat` (O3) |
| Clients | create, edit, duplicates, tabs | PASS | pages PASS; create caught by the guard |
| Policies | new, direct-bill, cancel, pending non-pay, reinstate | PASS | pages PASS; no writes tried |
| Renewals | renew a policy, renewal tab | PASS | pages PASS |
| Sales | quote form, pipeline, opportunity | PASS | PASS |
| Certificates and claims | issue, supersede, revoke, PDF, claims | PASS (canary crawl hit F14 on inbox, not here) | PDFs valid; issue caught by the guard; `/claims` list hit F14 once, passed on retry |
| AI Assistant | off-without-key message, request refusals, each role's view, admin usage | PASS | `/assistant` and `/assistant/about` PASS; `/admin/assistant` refused for `uat` |
| Accounting | receipts, statements, credits, export, ledger balance | PASS | not covered (O3) |
| Reports | reports and CSV exports | PASS | `/reports` PASS; renewals and users reports refused (O3); CSVs refused by the guard |
| Admin | users, sign-ins, audit, settings, new user | PASS | all admin sub-pages refused for `uat` (O3) |
| Read-only safety | canary fingerprint, guard | PASS (no table changed) | 4 writes caught, 2 refused GETs, no write when a page was only opened |
| Page integrity | no page errors while crawling | FAIL (F14 on `/inbox?tab=all`) | flaky (F14 on `/claims?status=all&page=1`, clean on retry) |
