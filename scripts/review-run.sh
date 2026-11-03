#!/usr/bin/env bash
# Run one review agent, completely on its own.
#
#   scripts/review-run.sh code|security|ux|uat [force] [sandbox|canary|prod]
#   scripts/review-run.sh all [force]        each agent in its own process, at the same time
#   scripts/review-run.sh <agent> status     what would run, without running it
#
# Independence, by construction rather than by asking nicely:
#  - Its own snapshot (.review/<agent>): a copy of the code, its own agent definition, its own previous
#    report, and nothing else. No other agent's report, definition or mockups, no ledger, no memory, no
#    secrets. It cannot see what is not there.
#  - Its own process: a fresh `claude -p` started in that folder with a scrubbed environment, no memory,
#    no user settings, no session history, no MCP servers, and only Read, Grep, Glob and Bash. There is
#    no tool that reaches another agent, and nothing is passed between runs.
#  - A guard on every tool call (scripts/review-guard.py) keeps it inside the snapshot and read-only.
#  - The runner writes the agent's final message to docs/agent-reports/<agent>/REPORT.md as it stands
#    and folds it into the ledger. Agents never see the ledger, which is the only place results meet.
#
# A run is skipped when the code it covers has not changed since its last run, unless `force`.
# Costs usage on your Claude plan. REVIEW_MODEL overrides the model. Logs: .review/logs/.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WHAT="${1:-}"; MODE="${2:-}"; PASS="${3:-all}"
case "$MODE" in force|status|"") ;; sandbox|canary|prod) PASS="$MODE"; MODE="" ;; *) echo "Unknown option $MODE"; exit 2 ;; esac

if [ "$WHAT" = all ]; then
  status=0; pids=()
  for k in code security ux uat; do "$0" "$k" $MODE & pids+=($!); done
  for p in "${pids[@]}"; do wait "$p" || status=1; done
  exit $status
fi

case "$WHAT" in
  code) AGENT=code-auditor ;;
  security) AGENT=security-reviewer ;;
  ux) AGENT=ux-reviewer ;;
  uat) AGENT=uat-tester ;;
  *) echo "Usage: scripts/review-run.sh code|security|ux|uat|all [force]"; exit 2 ;;
esac

KEY="$WHAT"
WS="$ROOT/.review/$KEY"
REPORTS="$ROOT/docs/agent-reports"
STATE="$ROOT/.review/state/$KEY"
LOGS="$ROOT/.review/logs"
STAMP="$(date '+%Y%m%d-%H%M%S')"
LOG="$LOGS/$KEY-$STAMP.log"
CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"
mkdir -p "$ROOT/.review/state" "$LOGS"

# What each agent covers: a change elsewhere doesn't trigger it. Same paths in the repo and the snapshot.
scope_files() {  # dir
  (cd "$1" || exit 1
   if [ "$KEY" = ux ]; then
     find web/src/app web/src/components web/src/lib/pdf.ts web/src/lib/priority.ts web/src/lib/work.ts web/src/lib/roadmap.ts -type f -print0
   else
     find web/src web/migrations web/scripts web/test scripts uat web/next.config.ts web/Dockerfile web/fly.toml web/package.json docker-compose.yml \
       -type d \( -name node_modules -o -name .work -o -name test-results \) -prune -o -type f -print0
   fi 2>/dev/null)
}
fingerprint() {  # dir: a hash of the covered files' names and contents
  (cd "$1" && scope_files . | LC_ALL=C sort -z | xargs -0 shasum -a 256 2>/dev/null | shasum -a 256 | cut -c1-8)
}

NOW_FP="$(fingerprint "$ROOT")"
if [ "$MODE" = status ]; then
  echo "$KEY: code $NOW_FP; last run on $(sed -n 1p "$STATE" 2>/dev/null || echo none) at $(sed -n 2p "$STATE" 2>/dev/null || echo never)"
  exit 0
fi
if [ "$MODE" != force ] && [ -f "$STATE" ] && [ "$(sed -n 1p "$STATE")" = "$NOW_FP" ]; then
  echo "$KEY: no changes since its last run ($(sed -n 2p "$STATE"), code $NOW_FP). Skipped. Add 'force' to run anyway."
  exit 0
fi

LOCK="$ROOT/.review/lock-$KEY"
if ! mkdir "$LOCK" 2>/dev/null; then echo "$KEY: a run is already in progress ($LOCK)."; exit 1; fi
trap 'rmdir "$LOCK" 2>/dev/null; rm -f "$ROOT/.review/state/uat-cred.$$"; [ "${REVIEW_KEEP:-0}" = 1 ] || rm -rf "$WS"' EXIT

# ---- The snapshot: only what this agent is meant to see ----
rm -rf "$WS"; mkdir -p "$WS/docs/agent-reports/$KEY" "$WS/.claude/agents" "$WS/.claude/hooks"
copy() { rsync -a --exclude node_modules --exclude .next --exclude '*.tsbuildinfo' --exclude '.env' --exclude '.env.local' --exclude '.env.*.local' \
  --exclude 'agent-reports/*' --exclude .work --exclude test-results --exclude .DS_Store "$@"; }
copy web "$WS/"
cp README.md docs/AMS-MVP-Scope.md "$WS/" 2>/dev/null; mv "$WS/AMS-MVP-Scope.md" "$WS/docs/" 2>/dev/null
cp docs/INBOUND_EMAIL.md "$WS/docs/" 2>/dev/null
if [ "$KEY" != ux ]; then
  copy scripts "$WS/"; cp docker-compose.yml .gitignore "$WS/" 2>/dev/null
  [ -d uat ] && copy uat "$WS/"
fi
[ -d "$REPORTS/$KEY" ] && copy "$REPORTS/$KEY/" "$WS/docs/agent-reports/$KEY/"
cp ".claude/agents/$AGENT.md" "$WS/.claude/agents/"
cp scripts/review-guard.py "$WS/.claude/hooks/review-guard.py"
cat > "$WS/.claude/settings.json" <<JSON
{
  "permissions": { "deny": ["Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Agent", "Task", "SendMessage"] },
  "hooks": { "PreToolUse": [ { "matcher": "Read|Grep|Glob|Bash", "hooks": [ { "type": "command",
    "command": "python3 \"\$CLAUDE_PROJECT_DIR/.claude/hooks/review-guard.py\" $KEY", "timeout": 20 } ] } ] }
}
JSON
# Checks need installed tools. Copies, so nothing in a snapshot leads back to the repository (cheap clones on APFS).
clone() { cp -cR "$1" "$2" 2>/dev/null || cp -R "$1" "$2"; }
if [ "$KEY" != ux ]; then clone "$ROOT/web/node_modules" "$WS/web/node_modules"; fi
if [ "$KEY" = uat ] && [ -d uat/node_modules ]; then clone "$ROOT/uat/node_modules" "$WS/uat/node_modules"; fi

FP="$(fingerprint "$ROOT")"
PROMPT="Run your review now, following your instructions in full. The code version is $FP. Return the complete report in the required Markdown format as your final message, with nothing before or after it."
[ "$KEY" = uat ] && PROMPT="$PROMPT Pass to run: $PASS."

echo "$KEY: started on code $FP ($(date '+%H:%M')), log $LOG"
OUT="$LOGS/$KEY-$STAMP.out"
# A scrubbed environment: nothing from the session that launched this comes along.
EXTRA=()
if [ "$KEY" = uat ] && grep -q '^uat=' .fly-credentials 2>/dev/null; then
  # The UAT agent gets its one login and never the file holding everyone else's.
  CRED="$ROOT/.review/state/uat-cred.$$"
  (umask 077; grep '^uat=' .fly-credentials > "$CRED")
  EXTRA+=("UAT_CRED_FILE=$CRED")
fi
# The operating system's word on it, not just the guard's: on a Mac the agent's whole process tree can
# read only the parts of the home folder its tools need, so not the repository, anyone's memory and
# transcripts, or other tools' credentials. Network stays open: the profile language can't allow one host,
# and the UAT agent needs the live site.
SANDBOX=()
if [ "$(uname)" = Darwin ] && command -v sandbox-exec >/dev/null; then
  PROFILE="$ROOT/.review/state/sandbox-$KEY.sb"
  CRED_RULE=""; [ -n "${CRED:-}" ] && CRED_RULE="(allow file-read* (literal \"$CRED\"))"
  # The UAT agent drives Docker and a browser. Docker's credential helper logs under its container folder,
  # and Chromium won't start unless it can stat the folders above its cache. Only names, nothing inside them.
  UAT_RULE=""
  if [ "$KEY" = uat ]; then
    DD="$HOME/Library/Containers/com.docker.docker"
    UAT_RULE="(allow file-read-metadata (literal \"$HOME/Library\") (literal \"$HOME/Library/Containers\") (literal \"$DD\") (literal \"$DD/Data\"))
(allow file-read* file-write* (subpath \"$DD/Data/log\"))"
  fi
  cat > "$PROFILE" <<SB
(version 1)
(allow default)
(deny file-read* file-write* (subpath "$HOME"))
(allow file-read-metadata (literal "$HOME") (literal "$(dirname "$HOME")"))
(allow file-read* file-write* (subpath "$HOME/.claude") (regex #"^$HOME/\.claude\.json") (subpath "$HOME/.npm") (subpath "$HOME/.cache") (subpath "$HOME/Library/Caches") (subpath "$HOME/.docker"))
(allow file-read* (subpath "$HOME/.local") (subpath "$HOME/Library/Keychains") (subpath "$HOME/Library/Preferences") (literal "$HOME/.gitconfig"))
(deny file-read* file-write* (subpath "$HOME/.claude/projects") (literal "$HOME/.claude/history.jsonl"))
(allow file-read* file-write* (subpath "$WS"))
(allow file-read* (literal "$ROOT") (literal "$(dirname "$ROOT")") (literal "$ROOT/.review"))
$CRED_RULE
$UAT_RULE
SB
  SANDBOX=(sandbox-exec -f "$PROFILE")
else
  echo "$KEY: no OS sandbox on this machine; the guard is the only confinement."
fi
(
  cd "$WS" || exit 1
  exec ${SANDBOX[@]+"${SANDBOX[@]}"} env -i HOME="$HOME" USER="${USER:-}" LOGNAME="${LOGNAME:-${USER:-}}" PATH="$PATH" LANG="${LANG:-en_US.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" \
    CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 DISPLAY_TZ=America/New_York ${EXTRA[@]+"${EXTRA[@]}"} \
    "$CLAUDE_BIN" -p "$PROMPT" --agent "$AGENT" --model "${REVIEW_MODEL:-claude-opus-5-5}" \
      --tools "Read,Grep,Glob,Bash" --allowedTools "Read,Grep,Glob,Bash" \
      --strict-mcp-config --setting-sources project --no-session-persistence --permission-mode dontAsk \
      < /dev/null > "$OUT" 2> "$LOG"
) &
RUN=$!
# The sleep goes when the watcher does, or it would outlive the run and hold this script's output open.
( sleep "${REVIEW_TIMEOUT:-5400}" & S=$!; trap 'kill "$S" 2>/dev/null' EXIT TERM; wait "$S" && kill "$RUN" 2>/dev/null ) & WATCH=$!
wait "$RUN"; RC=$?
kill "$WATCH" 2>/dev/null; wait "$WATCH" 2>/dev/null
if [ $RC -ne 0 ]; then echo "$KEY: the agent exited with code $RC. Nothing written. See $LOG and $OUT."; exit 1; fi

python3 scripts/review-save.py "$KEY" "$OUT" "$REPORTS" || { echo "$KEY: see $OUT"; exit 1; }
{ echo "$FP"; date '+%Y-%m-%d %H:%M'; } > "$STATE"
(cd web && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/register.mjs scripts/agent-ledger.ts) || echo "$KEY: report saved, but the ledger was not updated."
echo "$KEY: finished. Report: docs/agent-reports/$KEY/REPORT.md"
