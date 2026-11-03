#!/usr/bin/env bash
# Print "<table> <rows> <md5 of every row>" for every table in the UAT sandbox's database. Run before
# and after the read-only pass: any difference means a "read-only" function wrote, and the canary
# fails. Sandbox only: it talks to the siryous-ams-uat project, nothing else.
#
# Excluded, because reading a page legitimately writes them (see scripts/uat.sh for the third known
# write, the daily automation, which is settled before the first fingerprint rather than excluded):
#   - login_events            sign-in events
#   - users.last_active_at    web/src/lib/user.ts touches it on page views; every other users column is hashed
#   - audit_events rows with action report.exported: downloading a report is audited on purpose, even though it's a GET
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DC=(docker compose -p siryous-ams-uat --project-directory "$ROOT" -f "$ROOT/docker-compose.yml" -f "$ROOT/uat/docker-compose.uat.yml")
SQL="SELECT table_name || ' ' || (xpath('/row/n/text()', x))[1]::text || ' ' || (xpath('/row/h/text()', x))[1]::text
FROM (SELECT table_name, query_to_xml(format(
  'SELECT count(*) AS n, md5(coalesce(string_agg(%1\$s, ''|'' ORDER BY %1\$s), '''')) AS h FROM public.%2\$I t %3\$s',
  CASE table_name WHEN 'users' THEN '(to_jsonb(t) - ''last_active_at'')::text' ELSE 't::text' END, table_name,
  CASE table_name WHEN 'audit_events' THEN 'WHERE t.action <> ''report.exported''' ELSE '' END),
  false, true, '') AS x
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'login_events') s
ORDER BY 1;"
"${DC[@]}" exec -T db psql -U ams -d ams -tAc "$SQL"
