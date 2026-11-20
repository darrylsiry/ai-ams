#!/usr/bin/env bash
# User-acceptance test run: tries every function of siryous AMS as a user would.
#
#   scripts/uat.sh            # sandbox + canary + prod
#   scripts/uat.sh sandbox    # full end-to-end flows, writes included, on a disposable local copy
#   scripts/uat.sh canary     # the read-only suite against the sandbox, proving it writes nothing
#   scripts/uat.sh prod       # the read-only suite against the live site
#   UAT_KEEP=1 scripts/uat.sh sandbox    # leave the sandbox up afterwards (http://127.0.0.1:3950)
#   UAT_REUSE=1 scripts/uat.sh canary    # use a sandbox already up instead of rebuilding it
#
# The root comes from this script's own location, not git: it also runs from a copied workspace
# folder with no git and no .fly-credentials.
#
# Nothing here writes to production:
#  - Writing flows run only in the sandbox: docker compose project siryous-ams-uat, its own database
#    volume, port 3950 on 127.0.0.1, built from ./web and wiped with `down -v` at the end.
#    playwright.config.ts refuses to run that suite against any non-localhost address.
#  - The live site gets the read-only suite only. Three layers stop a write: (1) the browser guard in
#    uat/tests/guard.ts aborts every non-GET request; (2) the API clients in that fixture only have
#    GET; (3) this script refuses to start if a read-only spec calls a write method directly. The
#    canary pass then proves on the sandbox, table by table, that the same suite leaves the data alone.
#  - /reports/csv adds an audit row on purpose. The guard refuses it, and /accounting/export, on production;
#    on the canary they run, and the fingerprint leaves out report.exported rows. See uat/tests/guard.ts.
#  - The production login: a `uat=` line in the file named by UAT_CRED_FILE, or UAT_PROD_USER and
#    UAT_PROD_PASS. No other login in that file is ever used. With no login, only the signed-out
#    (@public) checks run. Passwords are never printed.
#
# What a page view may legitimately write, and how the canary treats each one:
#  1. web/src/lib/automation.ts ensureDailyAutomation runs once a day on the first page view. The
#     canary makes one signed-in GET and waits for it to finish (settings key automation_last_run
#     set, activity and audit counts stable) BEFORE the first fingerprint, so it isn't blamed on the suite.
#  2. web/src/lib/user.ts updates users.last_active_at (and auto-provisions a missing profile; the
#     canary's login has a profile). last_active_at is left out of the users hash; other columns count.
#  3. Sign-in events go in login_events, which is left out of the fingerprint.
# Everything else changing is a canary failure.
#
# Never opened in any pass: anything under /admin/app-tests (another system's review reports).
#
# Results: uat/.work/results-<pass>.json (Playwright), blocked-<pass>.jsonl (writes the guard stopped),
# crawl-<pass>.json, canary.diff, summary.md. Exit code 0 only if every pass ran green.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WHAT="${1:-all}"
case "$WHAT" in all|sandbox|canary|prod) ;; *) echo "usage: scripts/uat.sh [all|sandbox|canary|prod]"; exit 2 ;; esac
PORT=3950
SANDBOX="http://127.0.0.1:$PORT"
PROD_URL="${UAT_PROD_URL:-https://siryous-ams.fly.dev}"
DC=(docker compose -p siryous-ams-uat --project-directory "$ROOT" -f docker-compose.yml -f uat/docker-compose.uat.yml)
WORK=uat/.work
# The login read-only passes use on the sandbox (sandbox-only password, see uat/docker-compose.uat.yml).
SB_USER=admin
SB_PASS=uat-sb-admin
mkdir -p "$WORK"
: > "$WORK/summary.md"
status=0
sandbox_is_up=0
note() { echo "$*" | tee -a "$WORK/summary.md"; }
psql_sb() { "${DC[@]}" exec -T db psql -U ams -d ams -tAc "$1" 2>/dev/null; }

ensure_deps() {
  if [ ! -d uat/node_modules/@playwright/test ]; then
    (cd uat && npm ci --no-audit --no-fund >/dev/null) || { echo "npm ci failed in uat/"; exit 2; }
  fi
  (cd uat && npx playwright install chromium >/dev/null 2>&1) || true
}

static_check() {
  # Layer 3 of the write guard: read-only specs may not call write methods or reach the database.
  if grep -nE '\.(post|put|patch|delete)\(|\bfetch\(|page\.request|context\.request|setInputFiles|child_process' uat/tests/readonly/*.ts; then
    note "- REFUSED: a read-only spec calls a write method directly (above). Fix it before running against production."
    exit 3
  fi
  # This suite stays independent of the review reports under that path: no spec may name it. Only the
  # fixtures (uat/tests/guard.ts, uat/tests/sandbox/fixtures.ts) do, to refuse it.
  if grep -rln --include='*.spec.ts' 'app-tests' uat/tests; then
    note "- REFUSED: a spec names /admin/app-tests (above). This suite must not open that area."
    exit 3
  fi
}

sandbox_up() {
  if [ "${UAT_REUSE:-0}" = 1 ] && curl -sf "$SANDBOX/api/live" >/dev/null 2>&1; then
    note "- Sandbox: reusing the one already running on $SANDBOX"
    sandbox_is_up=1
    return 0
  fi
  "${DC[@]}" down -v >/dev/null 2>&1 || true
  note "- Sandbox: building from $ROOT/web on $SANDBOX"
  sandbox_is_up=1
  "${DC[@]}" up -d --build > "$WORK/compose-up.log" 2>&1 || { note "  FAILED to start (see $WORK/compose-up.log)"; return 1; }
  local up=0
  for _ in $(seq 1 120); do
    if curl -sf "$SANDBOX/api/live" >/dev/null 2>&1; then up=1; break; fi
    sleep 2
  done
  [ $up = 1 ] || { note "  sandbox never answered /api/live"; return 1; }
  # The seed runs in the background after boot. Client rows appear early and the seed keeps going, so
  # the count alone doesn't mean it finished: the server logs the seed child's exit too.
  local n=0 done_line=""
  for _ in $(seq 1 300); do
    n=$(psql_sb "select count(*) from clients" | tr -d '[:space:]')
    done_line=$("${DC[@]}" logs web 2>/dev/null | grep -E 'seed finished with code' | tail -1 || true)
    if [ "${n:-0}" -gt 400 ] && [ -n "$done_line" ]; then break; fi
    sleep 2
  done
  if [ "${n:-0}" -le 400 ] || ! echo "$done_line" | grep -q 'code 0'; then
    note "  seed did not finish: $n clients; ${done_line:-no seed exit logged} (see: docker compose -p siryous-ams-uat logs web)"
    return 1
  fi
  note "- Sandbox seeded: $n clients"
}

sandbox_down() {
  [ "$sandbox_is_up" = 1 ] || return 0
  sandbox_is_up=0
  if [ "${UAT_KEEP:-0}" = 1 ]; then note "- Sandbox left running on $SANDBOX; stop it with: docker compose -p siryous-ams-uat -f docker-compose.yml -f uat/docker-compose.uat.yml down -v"; return; fi
  "${DC[@]}" down -v >/dev/null 2>&1 && note "- Sandbox removed (containers and database volume)"
}
trap sandbox_down EXIT

run_suite() {   # name mode base user pass [extra playwright args]
  local name=$1 mode=$2 base=$3 user=$4 pass=$5; shift 5
  rm -f "$WORK/blocked-$name.jsonl" "$WORK/hydration-$name.log"; rm -rf "$WORK/artifacts-$name" "$WORK/hydration-$name"
  (cd uat && UAT_ROOT="$ROOT" UAT_PASS_NAME="$name" UAT_MODE="$mode" UAT_BASE_URL="$base" UAT_USER="$user" UAT_PASS="$pass" npx playwright test "$@") > "$WORK/run-$name.log" 2>&1
  local rc=$?
  # A password must never reach a log, however a tool chose to print it.
  if [ -n "$pass" ] && [ "$name" = prod ]; then
    PASS_TO_SCRUB="$pass" perl -pi -e 's/\Q$ENV{PASS_TO_SCRUB}\E/[password]/g' "$WORK/run-$name.log" "$WORK/results-$name.json" 2>/dev/null || true
  fi
  local line; line=$(grep -E '^\s+[0-9]+ (passed|failed|skipped|flaky|did not run|interrupted)' "$WORK/run-$name.log" | tr -s ' ' | paste -sd, -)
  note "- $name: ${line:-no result line} (exit $rc; log $WORK/run-$name.log)"
  [ -s "$WORK/blocked-$name.jsonl" ] && note "  stopped by the guard: $(grep -vc '"method":"GET"' "$WORK/blocked-$name.jsonl" | tr -d ' ') writes, $(grep -c '"method":"GET"' "$WORK/blocked-$name.jsonl" | tr -d ' ') refused GETs (see $WORK/blocked-$name.jsonl)"
  [ -s "$WORK/hydration-$name.log" ] && note "  React hydration errors noted during the flows: $(wc -l < "$WORK/hydration-$name.log" | tr -d ' ') (see $WORK/hydration-$name.log)"
  [ -d "$WORK/hydration-$name" ] && note "  React hydration errors captured (server HTML, page and console): $(ls "$WORK/hydration-$name" | grep -c info.json) in $WORK/hydration-$name"
  return $rc
}

canary_settle() {
  # Known write 1: let the daily automation finish before the first fingerprint.
  curl -s -o /dev/null -u "$SB_USER:$SB_PASS" -H 'Accept: text/html' "$SANDBOX/" || { note "  canary: the settling page view failed"; return 1; }
  local last="" a1="" a2="" stable=0
  for _ in $(seq 1 90); do
    last=$(psql_sb "select value from settings where key = 'automation_last_run'" | tr -d '[:space:]')
    a2=$(psql_sb "select (select count(*) from activities) || '/' || (select count(*) from audit_events)" | tr -d '[:space:]')
    # The seed sets this key to "never"; the automation sets it to the date it ran.
    if echo "$last" | grep -qE '^"?[0-9]{4}-[0-9]{2}-[0-9]{2}"?$' && [ "$a1" = "$a2" ]; then
      stable=$((stable + 1))
      [ $stable -ge 3 ] && return 0
    else
      stable=0
    fi
    a1=$a2
    sleep 2
  done
  note "  canary: the daily automation never settled (last run: ${last:-none}, activities/audit: $a2)"
  return 1
}

run_canary() {
  canary_settle || { status=1; return; }
  local audit_before; audit_before=$(psql_sb "select coalesce(max(id), 0) from audit_events" | tr -d '[:space:]')
  uat/db-fingerprint.sh > "$WORK/fingerprint-before.txt" || { note "- CANARY: fingerprint failed"; status=1; return; }
  run_suite canary readonly "$SANDBOX" "$SB_USER" "$SB_PASS" || status=1
  sleep 3   # fire-and-forget updates from the last page view
  uat/db-fingerprint.sh > "$WORK/fingerprint-after.txt" || { note "- CANARY: fingerprint failed"; status=1; return; }
  diff "$WORK/fingerprint-before.txt" "$WORK/fingerprint-after.txt" > "$WORK/canary.diff"
  local changed; changed=$(grep -E '^>' "$WORK/canary.diff" | awk '{print $2}' | paste -sd, - || true)
  note "- Canary excludes: login_events, users.last_active_at; the daily automation is settled before the first fingerprint (see scripts/uat.sh)."
  if [ -n "$changed" ]; then
    status=1
    note "- CANARY FAILED: the read-only pass changed these tables: $changed (see $WORK/canary.diff)"
    {
      echo; echo "Audit rows added during the read-only pass (action, actor, rows):"
      psql_sb "select action, actor, count(*) from audit_events where id > $audit_before group by 1, 2 order by 1, 2" | sed 's/^/  /'
      echo "ledger_entries with exported_batch set: $(psql_sb "select count(*) from ledger_entries where exported_batch is not null")"
    } | tee -a "$WORK/canary.diff" | tee -a "$WORK/summary.md"
  else
    note "- Canary: no table changed during the read-only pass"
  fi
}

ensure_deps
static_check

if [[ "$WHAT" == all || "$WHAT" == sandbox || "$WHAT" == canary ]]; then
  sandbox_up || { status=1; sandbox_down; note "- Overall: FAIL"; exit 1; }
  if [[ "$WHAT" == all || "$WHAT" == sandbox ]]; then
    run_suite sandbox sandbox "$SANDBOX" "$SB_USER" "$SB_PASS" || status=1
  fi
  if [[ "$WHAT" == all || "$WHAT" == canary ]]; then
    run_canary
  fi
  sandbox_down
fi

if [[ "$WHAT" == all || "$WHAT" == prod ]]; then
  user="${UAT_PROD_USER:-}"; pass="${UAT_PROD_PASS:-}"
  if [ -z "$user" ] && [ -n "${UAT_CRED_FILE:-}" ] && grep -q '^uat=' "$UAT_CRED_FILE" 2>/dev/null; then
    user=uat; pass="$(grep '^uat=' "$UAT_CRED_FILE" | head -1 | cut -d= -f2-)"
  fi
  if [ -z "$user" ] || [ -z "$pass" ]; then
    note "- prod: no uat login, so only the signed-out checks run. Add a uat= line to the file named by UAT_CRED_FILE, or set UAT_PROD_USER and UAT_PROD_PASS."
    run_suite prod readonly "$PROD_URL" uat-signed-out none --grep @public || status=1
  else
    run_suite prod readonly "$PROD_URL" "$user" "$pass" || status=1
  fi
fi

note "- Overall: $([ $status = 0 ] && echo PASS || echo FAIL)"
exit $status
