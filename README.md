# siryous AMS

An agency management system for a property and casualty agency: clients, policies, renewals,
certificates, claims, sales, agency-bill accounting and direct-bill commissions, built around a
prioritized daily work queue and email that turns into tasks.

This is the first build of the MVP defined in [docs/AMS-MVP-Scope.md](docs/AMS-MVP-Scope.md), drawn
from the master list in [docs/AMS-Process-Catalog.md](docs/AMS-Process-Catalog.md). Anything visible in
the app that is not in the MVP carries a grey "Not in MVP" or amber "Pending" tag; Admin > Roadmap lists them all.

> Internal. The catalog draws on confidential vendor material. Do not publish this repository.

## Run it locally

You need Docker and Node 22.

```bash
docker compose up -d db
```

```bash
cd web && cp .env.example .env.local && npm install
```

```bash
npm run seed
```

```bash
npm run dev
```

Open http://localhost:3200. Locally there is no sign-in page: choose who you are from the
"Working as" menu in the header. Start as **Marisol Rivera** (commercial account manager) to see a
full day of work, **Catherine Holloway** (principal) for the team view, **Lisa Morgan** for accounting,
or **Morgan Ellis** (admin) for user management.

`npm run seed:reset` wipes and rebuilds the demo data. `docker compose up --build` runs the whole stack
in containers instead.

## The demo agency

Siryous Insurance Agency, Raleigh and Charlotte, with 12 staff and history from 1 January 2026 to
today: about 400 clients, 1,700 policy terms, 14,000 activities, 6,000 emails, certificates, claims,
opportunities, invoices, receipts, carrier and commission statements, producer statements, the ledger,
sign-ins and the audit trail. Every name, carrier and number is fictional. Same seed, same data.

## How an account manager works

**My Day** is the home page. It answers "what should I do next?" with one ranked queue:

- **Now** holds what is urgent or overdue. **Today** holds what is due today. **Later** holds the rest.
- Each task's score comes from its priority, how overdue it is, what kind of work it is (non-payment, cancellation, binder expiring, new claim, certificate request), days to renewal, the client's premium, and how long an email has waited. The chips on each task say why it ranks where it does.
- **Start next task** opens the top task in focus view: the email, the client, the policy, the checklist and one-click actions (complete, snooze, waiting on someone, reassign, issue the certificate, start the endorsement).
- Waiting tasks come back as "chase" items on their follow-up date. Snoozed tasks come back when due.
- Principals and admins can switch to team priorities and rebalance work.

Keyboard: `/` searches, `n` creates a task.

Daily automation runs on the first page view of each day, or from a scheduler with
`POST /api/cron/daily` and the `CRON_TOKEN`. It opens renewal reviews at each line's lead time,
escalates renewals a week out, warns before binders lapse and pending cancellations take effect, expires
and cancels terms on their dates, and raises tasks for past-due invoices, expiring producer licenses and
quiet open claims. It never does the same thing twice.

## Email to action

Forward or copy any email to `<your-alias>@INBOUND_EMAIL_DOMAIN`, or to the shared `service@`
address. The AMS finds the client and policy, decides what is being asked, and puts one task in the
right queue with the email and attachments filed. Setup for Postmark, Mailgun, SendGrid and Cloudflare
is in [docs/INBOUND_EMAIL.md](docs/INBOUND_EMAIL.md). Inbox > Test email intake tries it without a
mail provider.

## Users and roles

Sign-in works like the Underwriting Desktop. Passwords live in the `BASIC_AUTH_USERS` secret,
browsers get a signed session cookie, and API callers can use HTTP Basic. Every sign-in is logged with
address and approximate location (Reports > Users). Profiles, roles, branches, inbox aliases, licenses
and producer splits are managed in Admin > Users.

| Role | Can |
|---|---|
| Administrator | everything, including users, settings, the audit trail and sign-in reports |
| Principal | everything except system administration |
| Account manager | work clients and policies; see accounting |
| CSR, Producer | work clients and policies |
| Accounting | post receipts, statements and payables; lock periods; all reports |

Seeing dates of birth, license numbers and FEINs is a separate per-user flag.

## Reports

Activity by person and type, user workload and sign-ins, new and renewal production, book of business,
renewal retention, commissions, email intake and claims. Reports filter by date range and export to CSV.
Receivables aging and the trust position are under Accounting.

## Accounting

A double-entry sub-ledger with a balance check on every posting and period locks. Agency-bill
invoices, receipts into trust, returned payments, client refunds, carrier statements paid by statement,
direct-bill commission statements matched line by line, producer statements, and a trust sweep that
moves only earned money. The general ledger exports as summary CSV, detail CSV or a QuickBooks IIF file.

## Deploy to Fly.io

```bash
fly auth login
```

```bash
scripts/fly-deploy.sh
```

The script is safe to re-run. It creates the app `siryous-ams` and a Managed Postgres cluster, attaches
the database, generates every secret, and deploys. The first boot migrates. A new database starts empty:
`SEED_ON_EMPTY` is off so demo data can't land beside real clients. Signing in with the first configured
login (or `AMS_ADMIN_USER`) on a database with no administrator makes that login the administrator. For a
demo agency, set `SEED_ON_EMPTY=1` before the first boot. The admin sign-in is saved to `.fly-credentials`, which is git-ignored, and never printed.

Add sign-ins for staff by username:

```bash
scripts/fly-users.sh choll mrivera lmorgan
```

A new database starts empty: `SEED_ON_EMPTY` is `"0"` in [web/fly.toml](web/fly.toml), and `AMS_ADMIN_USER` or the
first login becomes the administrator. Set it to `"1"` only to rebuild the demo agency. To run daily automation on a
schedule while the machine sleeps, call `POST /api/cron/daily` with the `CRON_TOKEN` as a Bearer token
from any scheduler. A custom domain goes in `PUBLIC_BASE_URL` after `fly certs add`.

## Configuration

Every setting is described in [web/.env.example](web/.env.example). The ones that matter:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres |
| `BASIC_AUTH_USERS` | sign-in logins, `name:password,...`. A production build will not run without it; only `next dev` runs open. |
| `INBOUND_EMAIL_TOKEN`, `INBOUND_EMAIL_DOMAIN` | the inbound email webhook |
| `ANTHROPIC_API_KEY` | optional. Claude classifies email, checks policies against quotes, reads carrier statements and answers questions about an account. Without it, rules take over. |
| `SMTP_URL` | outbound email for replies and certificates. Until set, they are logged rather than sent. |

## Project layout

```
docker-compose.yml        local Postgres (port 5433) and an optional containerized app
docs/                     process catalog, MVP scope, inbound email setup, review agents and their reports
scripts/                  Fly deploy, Fly users, send a test email, review runner and UAT harness
web/
  migrations/             SQL schema, applied in order on boot
  scripts/seed.mjs        the demo agency
  src/app/(app)/          pages: My Day, tasks, inbox, clients, policies, renewals, sales,
                          certificates, claims, documents, accounting, reports, admin, search
  src/app/api/            inbound email, daily cron, health, live, web leads
  src/lib/                priority scoring, work queue, email pipeline, accounting, policies,
                          certificates, automation, PDFs, reports, users and sign-in
```

## Independent review agents

Four agents review the app on their own for code quality, security, UX and user acceptance. Each runs as
a separate process in its own snapshot, with no memory and no sight of the others. Their work is at
Admin > App Tests. See [docs/REVIEW_AGENTS.md](docs/REVIEW_AGENTS.md).

## Checks

```bash
cd web && npm run typecheck && npm test
```

## What goes to Anthropic

### AI Assistant

`/assistant` (and the box on My Day) answers questions about anything in the app, through read-only tools over the app's own data, and links every answer to its records. It's a tool-use loop in `web/src/lib/assistant.ts`, with its tools in `web/src/lib/assistant-tools.ts`.

- **It only reads.** No tool changes anything.
- **It sees what the asker's role can open on screen.** Tools are filtered by role, and person-scoped tools check the asker again. `/assistant/about` lists them for the person looking.
- **Some records never go to it, for anyone:** the date of birth, license and FEIN fields, driver details, confidential notes and restricted documents. Every result and question also passes through a filter for identifier-shaped text. That filter is a safety net, not a guarantee: free text can hold an identifier in a form it doesn't recognise.
- **Outside text is marked as data,** and answers can only link to real pages in the app, so an instruction or link planted in a client's email goes nowhere.
- **Limits:** 40 questions an hour and 2 at once per person, 12 rounds of lookups and 4 minutes per question.
- **Record:** Admin > AI Assistant use shows who asked what, what it looked at and the tokens used. Questions are kept scrubbed, in `assistant_log`.

When `ANTHROPIC_API_KEY` is set, each Claude feature can be switched in Admin > Settings. Email triage and
account questions send text, with identifier-shaped values such as SSNs and labelled dates of birth removed
first; identifiers with no label can still get through. Policy checking and commission statement reading send
**whole PDFs**, which can't be filtered, so both are off until an administrator turns them on. Decide what the
agency's Anthropic terms allow before turning them on or loading real client data.
