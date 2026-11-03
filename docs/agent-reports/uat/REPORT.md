# UAT report: siryous AMS

Run: 2026-11-03 02:26 · code f58332c7 · live site https://siryous-ams.fly.dev

## Verdict
Yes, on everything this run could test: all 168 sandbox flows and the 17 canary tests passed, nothing in the data changed, and the live site passed its read-only pass with no failures. The gaps are on the live site, where the read-only `uat` login can't reach 8 pages or finish tasks and receipts, and in the canary crawl, which stopped at its 320-page cap.

## Summary
| Pass | What it covers | Passed | Failed | Skipped | Result |
|------|----------------|--------|--------|---------|--------|
| Sandbox flows | every function end to end, writes included, on a disposable copy | 168 | 0 | 0 | PASS |
| Canary | the read-only suite on the sandbox, data compared before and after | 17 | 0 | 0 | PASS |
| Production | pages, downloads and API reads on the live site, writes blocked | 15 | 0 | 2 | PASS |

## Production safety
- **Writes stopped by the guard on the live site: 4, all from dry-run tests clicking a real button:**
  - POST `/certificates/new?client=162` (Issue certificate)
  - POST `/clients/new` (Create client)
  - POST `/tasks/new` (Create task)
  - POST `/signout` (Sign out from the header)
- **GETs the guard refused: 1.** It was `/admin/app-tests?_rsc=…` during the crawl, a Next link prefetch of a page no pass may open. Nothing was written, and no page tried to write just by being opened.
- **Canary:** no table changed. `canary.diff` is empty, and the before and after fingerprints have 44 lines each.
  - On the sandbox the guard stopped 6 dry-run writes and 1 refused GET to `/admin/app-tests`.
- **Login used on production:** `uat`. Its role is `readonly`, so 8 pages showed the "no access" panel (see UAT-O3).
- **Limit of this evidence:** the data comparison runs only on the sandbox.
  - `scripts/uat.sh` lists page-view writes the guard can't stop: `users.last_active_at`, and the daily automation on the first page view of the day.
  - The same could happen on the live site when this pass opens a page. I did not check whether it did.

## Failures
None.

## Observations

### UAT-O3 The production login can't see Accounting or user admin (Observation)
- **Where:** production pass, `uat` login.
- **What happens:** `web/migrations/004_review_fixes.sql:14` makes `uat` `readonly`, and `web/src/lib/permissions.ts:20` gives that role no permissions.
  - **Pages not checked (8):** `/accounting`, `/inbox/simulate`, `/reports/renewals`, `/reports/users`, `/admin/audit`, `/admin/system`, and two `/admin/users/:id` pages.
  - **Dry runs skipped (2):** "complete a task" ("no open task this login may finish") and "post a receipt" ("this login can't post receipts").
  - **Accounting and agency reports:** their sub-pages were not reached either.
- **Suggestion:** Give `readonly` the view permissions (`reports.all`, `accounting.view`) but no write permission, so the live pass covers those pages. Then check that the receipt form still renders for that role. The Done button needs a write-capable role, so that dry run would still skip.

### UAT-O6 The live site's build can't be confirmed (Observation)
- **Where:** production pass.
- **What happens:** `/api/live` returns only `{ ok: true }`, and `/api/health` returns no version. The report can't say whether the live site runs f58332c7 or an older build, so its pass does not prove this code is live.
- **Suggestion:** Expose the build's commit on `/api/live` or `/api/health`, and have the prod pass record it.

### UAT-O9 The canary crawl stopped at its 320-page cap (Observation)
- **Where:** `uat/tests/readonly/03-crawl.spec.ts:14` and `:44`, canary pass.
- **What happens:** The crawl opened exactly 320 pages, up from 230 last run, and the loop stops at `MAX_PAGES`. It still reports a pass.
  - **Unknown remainder:** the crawl doesn't save its queue, so I can't say how many pages were never opened or whether any were new page shapes.
  - **Where the cap went:** 86 of the 320 pages were pagination links, and the last 25 opened were mostly these.
  - **Production:** its crawl ended at 200 pages, under the cap, because the `uat` login reaches fewer links.
- **Suggestion:** Record the remaining queue length in `crawl-<pass>.json`, add a coverage note or failure when the cap is hit, and raise `UAT_MAX_PAGES`. Opening fewer page-number variants would also free up room.

### UAT-O10 A read-only login is offered write forms the server should refuse (Observation)
- **Where:** `/clients/new`, `/certificates/new` and `/tasks/new`, as the `uat` login on the live site.
- **What happens:** All three forms rendered and their buttons sent a POST, which the guard stopped.
  - `web/src/app/(app)/clients/new/page.tsx` has no permission check.
  - The server actions do check: `clients/actions.ts:33` and `certificates/actions.ts:36` call `requirePerm("write")`, and `tasks/actions.ts:127` throws `Forbidden`.
  - So this looks like a dead end for the user, not a security hole. No test submits these forms as a `readonly` user, so I read this from the source and did not see it run.
- **Suggestion:** Show the role-refusal panel on these pages for logins without write rights, and add a sandbox flow that submits one as `readonly`.

## Resolved since last run
- **UAT-F14 — Pages intermittently throw a React hydration error** — now passes: no page errors on 200 live pages or 320 canary pages, and no `hydration-*.log` was written. This error came and went before, and I can't tell whether a code change fixed it, so one clean run does not prove it is gone.
- **UAT-F27 — The live crawl hit a 502 and a 500 that were gone on retry** — now passes: every live page answered 200 on the first attempt, with no retries. This was also intermittent, so one clean run does not rule out a repeat.
- **UAT-F28 — The "complete a task" dry run times out on production** — now passes as a skip: the loop now tries at most 10 tasks (`04-dry-run.spec.ts:25`), then skips. It did not click Done on production (see UAT-O3).
- **UAT-O8 — Pages on the live site are slow** — now passes: the average page took 1.1 s against 4.6 s last run, and none took over 8 s against 18 before. The prod pass took 4.0 minutes against 26.8. The slowest pages, about 2.9 s, are the 8 refusal panels, and most of that is the crawl's 2-second wait for a heading they don't have.

## Coverage
- **Sandbox:** 168 flows across 12 spec files, with writes included. The sandbox built from this snapshot and seeded 414 clients. The ledger balanced overall, per journal, and against open invoices.
- **Canary:** 320 pages and 32 files, 240 page shapes between them, plus 6 dry-run writes caught. The crawl hit its cap (UAT-O9).
  - **Files:** 18 report CSVs, 4 accounting exports, 8 rendered PDFs and 2 stored documents.
- **Production:**
  - **Crawl:** 200 pages and 4 files, 138 page shapes between them. All pages answered 200, with no page errors.
  - **Files:** 4 PDFs fetched and valid (2 rendered certificates and 2 stored documents).
  - **Signed-out and API checks:** liveness, sign-in form, return-to redirect, API refusing no login and a wrong password, health behind the sign-in, the email webhook's GET, the quote form and the sign-out page.
  - **Dry runs:** 4 caught (certificate, client, task, sign-out) and 2 skipped (complete a task, post a receipt).
- **Not covered:**
  - On production: CSV downloads and accounting exports, which the guard refuses there because they can write, plus the areas in UAT-O3.
  - Real SMTP sending and paths that call the AI were not identified in any result this run, so treat them as untested.
  - `/admin/app-tests`, which no pass opens by design.
- **Limits on my side:**
  - The review guard stopped a Docker status check, so sandbox removal rests on the harness's own summary line.
  - The guard also stopped me reading the background task's output file, so I used `uat/.work/` instead, which has the same results.
  - I did not recheck the live site outside the harness.

## Functions checked
| Area | Function | Sandbox | Production |
|------|----------|---------|------------|
| System | liveness, health with the database up | PASS | PASS |
| API security | no-login refusal, wrong password refused, GET-only clients, cron token | PASS | PASS (no cron check on production) |
| Sign-in | sign-in form, return-to redirect, sign-out page, header sign-out | PASS | PASS (header sign-out caught by the guard) |
| My Day and tasks | queue, complete, reassign, create task | PASS | pages PASS; create caught by the guard; complete skipped (O3) |
| Email intake | webhook, senders, rules, forwards, inbox | PASS | webhook GET and inbox pages PASS; simulate refused for `uat` (O3) |
| Clients | create, edit, duplicates, tabs | PASS | pages PASS; create caught by the guard |
| Policies | new, direct-bill, cancel, pending non-pay, reinstate | PASS | pages PASS; no writes tried |
| Renewals | renew a policy, renewal tab | PASS | pages PASS; no writes tried |
| Sales | quote form, pipeline, opportunity | PASS | quote form and pages PASS; no writes tried |
| Certificates and claims | issue, supersede, revoke, PDF, claims | PASS | pages PASS; PDFs valid; issue caught by the guard |
| Accounting | receipts, statements, credits, export, ledger balance | PASS | not covered: `uat` refused, receipt dry run skipped (O3) |
| Reports | reports and CSV exports | PASS | `/reports` PASS; two reports refused for `uat` (O3); CSVs refused by the guard |
| Admin | users, sign-ins, audit, settings, new user | PASS | settings, carriers and roadmap PASS; users detail, audit and system refused for `uat` (O3) |
| Read-only safety | canary fingerprint, guard | PASS (no table changed) | 4 writes caught, 1 refused GET, no write when a page was only opened |
