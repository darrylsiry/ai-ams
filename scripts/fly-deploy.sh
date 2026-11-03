#!/usr/bin/env bash
# Deploy siryous AMS to Fly.io: one app and one Managed Postgres cluster.
#
#   scripts/fly-deploy.sh                       # create what's missing, then deploy
#   FLY_APP=acme-ams scripts/fly-deploy.sh      # another app name
#
# Safe to re-run: the app, the cluster, the database, the attachment and the secrets are only
# created when missing. Creating the cluster and the app starts billing on your Fly.io account.
#
#   <app>        public, https://<app>.fly.dev, behind the sign-in page
#   <app>-db     Managed Postgres with database "ams", attached to the app as DATABASE_URL
#
# Secrets (generated once, never printed):
#   BASIC_AUTH_USERS     sign-in passwords; the first login ("admin", the bootstrap administrator) is
#                        saved to .fly-credentials (git-ignored, mode 600). More: scripts/fly-users.sh
#   SESSION_SECRET       signs the session cookie
#   INBOUND_EMAIL_TOKEN  authenticates the inbound email webhook (docs/INBOUND_EMAIL.md)
#   CRON_TOKEN           authenticates POST /api/cron/daily
#   ANTHROPIC_API_KEY    from .env or web/.env.local if set there: email classification, policy
#                        checking and statement reading; without it the app uses its rules engine.
set -euo pipefail

APP="${FLY_APP:-siryous-ams}"
REGION="${FLY_REGION:-iad}"
ORG="${FLY_ORG:-personal}"
PLAN="${FLY_PG_PLAN:-Basic}"
DB="$APP-db"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
CRED="$ROOT/.fly-credentials"

step() { printf '\n==> %s\n' "$*"; }
has_secret() { fly secrets list -a "$APP" --json 2>/dev/null | grep -q "\"$1\""; }
gen() { openssl rand -base64 32 | tr -d '/+=' | cut -c1-"${1:-32}"; }
cluster_id() {
  fly mpg list --org "$ORG" --json 2>/dev/null | python3 -c '
import json, sys
try:
    clusters = json.load(sys.stdin)
except ValueError:
    clusters = []
for c in clusters if isinstance(clusters, list) else []:
    if c.get("name", c.get("Name")) == sys.argv[1]:
        print(c.get("id", c.get("ID", "")))
' "$DB"
}
env_value() {  # NAME: its value in .env or web/.env.local, quotes, inline comment and whitespace stripped
  local raw="" f
  for f in .env web/.env.local; do
    raw="$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$f" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r' || true)"
    [ -n "$raw" ] && break
  done
  raw="${raw#"${raw%%[![:space:]]*}"}"
  case "$raw" in
    \"*) raw="${raw#\"}"; raw="${raw%%\"*}" ;;
    \'*) raw="${raw#\'}"; raw="${raw%%\'*}" ;;
    *) raw="${raw%%[[:space:]]#*}"; raw="${raw%"${raw##*[![:space:]]}"}" ;;
  esac
  printf '%s' "$raw"
}

command -v fly >/dev/null || { echo "Install flyctl first: https://fly.io/docs/flyctl/install/"; exit 1; }
fly auth whoami >/dev/null || { echo "Run 'fly auth login' first"; exit 1; }

step "App $APP in org $ORG"
if fly apps list --org "$ORG" --json | grep -q "\"$APP\""; then echo "$APP exists"; else fly apps create --name "$APP" --org "$ORG"; fi

step "Managed Postgres cluster $DB ($PLAN, $REGION)"
id="$(cluster_id)"
if [ -z "$id" ]; then
  # flyctl prints the connection string (with password) on create and attach; keep it off the terminal.
  fly mpg create --name "$DB" --org "$ORG" --region "$REGION" --plan "$PLAN" >/dev/null
  id="$(cluster_id)"
fi
[ -n "$id" ] || { echo "Could not find cluster $DB after creating it"; exit 1; }
echo "cluster $id"
if fly mpg databases list "$id" 2>/dev/null | grep -qw ams; then echo "database ams exists"; else fly mpg databases create "$id" --name ams; fi
if has_secret DATABASE_URL; then echo "$APP already has DATABASE_URL"
else fly mpg attach "$id" --app "$APP" --database ams --variable-name DATABASE_URL >/dev/null && echo "DATABASE_URL set"; fi

step "Secrets"
staged=()
if has_secret BASIC_AUTH_USERS; then
  echo "$APP already has sign-in logins (see .fly-credentials; add users with scripts/fly-users.sh)"
elif [ -n "${CI:-}" ]; then
  echo "$APP has no sign-in logins. Run scripts/fly-deploy.sh on your machine once to create them."; exit 1
else
  user="${AMS_ADMIN_USER:-admin}" pass="$(gen 24)"
  umask 077
  printf 'url=https://%s.fly.dev\n%s=%s\n' "$APP" "$user" "$pass" > "$CRED"
  staged+=("BASIC_AUTH_USERS=$user:$pass")
  echo "Login for $user saved to .fly-credentials"
fi
for name in SESSION_SECRET INBOUND_EMAIL_TOKEN CRON_TOKEN; do
  if has_secret "$name"; then echo "$APP already has $name"; else staged+=("$name=$(gen 40)"); echo "$name generated"; fi
done
key="$(env_value ANTHROPIC_API_KEY)"
case "$key" in ""|sk-ant-*) ;; *) echo "ANTHROPIC_API_KEY doesn't look like an Anthropic key (sk-ant-…); not setting it"; key="" ;; esac
if has_secret ANTHROPIC_API_KEY; then echo "$APP already has ANTHROPIC_API_KEY"
elif [ -n "$key" ]; then staged+=("ANTHROPIC_API_KEY=$key"); echo "ANTHROPIC_API_KEY from your env file"
else echo "No ANTHROPIC_API_KEY: email classification uses the rules engine; AI checks are off"; fi
if [ ${#staged[@]} -gt 0 ]; then printf '%s\n' "${staged[@]}" | fly secrets import --stage -a "$APP" >/dev/null; fi

overrides=()
[ "$APP" != "siryous-ams" ] && overrides=(-e "PUBLIC_BASE_URL=https://$APP.fly.dev")

step "Deploy"
# App Tests (admin only) reads the review agents' reports; on Fly they are baked into the image from
# docs/agent-reports, then removed here so no later local or UAT build carries them.
clear_reports() { find "$ROOT/web/agent-reports" -mindepth 1 ! -name .gitkeep -exec rm -rf {} + 2>/dev/null || true; }
trap clear_reports EXIT
clear_reports
[ -d "$ROOT/docs/agent-reports" ] && cp -R "$ROOT/docs/agent-reports/." "$ROOT/web/agent-reports/"
# --config is resolved relative to the build directory, so pass it absolute.
fly deploy web --config "$ROOT/web/fly.toml" --app "$APP" --ha=false ${overrides[@]+"${overrides[@]}"}

step "Done"
echo "siryous AMS: https://$APP.fly.dev   (sign-in in .fly-credentials)"
echo "Health:      https://$APP.fly.dev/api/health"
echo "A new database starts empty (SEED_ON_EMPTY is off). The first sign-in as the admin login creates the administrator."
echo "Inbound email webhook: https://$APP.fly.dev/api/inbound/email  (token: fly ssh console -a $APP -C 'printenv INBOUND_EMAIL_TOKEN')"
