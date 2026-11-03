#!/usr/bin/env python3
"""Checks the review guard: what each agent may and may not do. Run: python3 scripts/review-guard-test.py"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = "/x/AI AMS/.review/code"
ROOTS = {a: f"/x/AI AMS/.review/{a}" for a in ("code", "security", "ux", "uat")}


def run(agent, tool, inp):
    p = subprocess.run([sys.executable, os.path.join(HERE, "review-guard.py"), agent], input=json.dumps({"tool_name": tool, "tool_input": inp}),
                       capture_output=True, text=True, env={**os.environ, "CLAUDE_PROJECT_DIR": ROOTS[agent]})
    return p.returncode == 0


def bash(agent, cmd):
    return run(agent, "Bash", {"command": cmd})


CASES = [
    # Allowed
    (True, "code", "cat web/src/lib/db.ts"), (True, "code", "cd web && npx tsc --noEmit"), (True, "code", "cd web && npm test 2>&1 | tail -5"),
    (True, "code", "grep -rn requirePerm web/src | wc -l"), (True, "code", "date '+%Y-%m-%d %H:%M'"), (True, "code", "ls docs/agent-reports/code 2>/dev/null"),
    (True, "security", "cd web && npm audit --omit=dev --json | head -c 20000"),
    (True, "ux", "curl -s -m 3 http://localhost:3200/api/live"), (True, "ux", "curl -s -b ams_user=mrivera http://localhost:3200/tasks | sed -e 's/<[^>]*>/ /g' | tr -s ' \\n'"),
    (True, "uat", "scripts/uat.sh"), (True, "uat", "scripts/uat.sh sandbox"), (True, "uat", "cat uat/.work/summary.md"),
    (True, "uat", "cd uat && UAT_PASS_NAME=x UAT_MODE=sandbox UAT_BASE_URL=http://127.0.0.1:3950 npx playwright test -g \"title\""),
    (True, "ux", "curl -s -b ams_user=mrivera http://localhost:3200/tasks | grep -o 'tasks/[0-9]*' | head -3"),
    # Independence
    (False, "uat", "v=UAT_CRED_FILE; cat \"${!v}\""), (False, "code", "eval \"cat secret\""), (False, "code", "echo Y2F0 | base64 -d | sh"), (False, "code", "cat web/node_modules/../../docs/agent-reports/code/REPORT.md"),
    (False, "code", "cat /Users/djsiry/GitHub/AI\\ AMS/docs/agent-reports/security/REPORT.md"), (False, "code", "cat ../security/docs/agent-reports/security/REPORT.md"),
    (False, "code", "cat docs/agent-reports/ux/REPORT.md"), (False, "ux", "cat ~/.claude/projects/x/memory/MEMORY.md"), (False, "ux", "cat $HOME/.claude/CLAUDE.md"),
    (False, "uat", "grep -r CR-001 /Users/djsiry"), (False, "code", "find / -name REPORT.md"), (False, "code", "cd .. && ls"), (False, "code", "cat AGENT_LEDGER.json"),
    (False, "code", "claude -p hello"), (False, "ux", "curl -s http://localhost:3200/admin/app-tests"), (False, "uat", "curl -s http://127.0.0.1:3950/admin/app-tests/code"),
    (False, "uat", "cat $UAT_CRED_FILE"), (False, "uat", "cat .fly-credentials"), (False, "code", "printenv"), (False, "code", "cat web/.env.local"),
    # Read-only
    (False, "code", "echo x > web/src/a.ts"), (False, "code", "rm -rf web"), (False, "code", "sed -i '' s/a/b/ web/x"), (False, "code", "npm install lodash"),
    (False, "code", "docker compose up"), (False, "ux", "npx tsc --noEmit"), (False, "ux", "npm test"), (False, "security", "npm test"), (False, "code", "python3 -c \"open('x','w')\""),
    (False, "uat", "fly deploy"), (False, "uat", "scripts/fly-deploy.sh; fly secrets list"), (False, "uat", "docker compose -p siryous-ams up -d"), (False, "uat", "rm -rf uat"),
    # Network
    (False, "code", "curl -s https://example.com"), (False, "uat", "curl -X POST https://siryous-ams.fly.dev/api/leads"), (False, "uat", "curl -s https://siryous-ams.fly.dev/"),
    (False, "ux", "curl -X POST http://localhost:3200/tasks"), (False, "ux", "curl -s http://localhost:3201/"), (False, "ux", "curl -s https://siryous-ams.fly.dev"),
]
TOOLS = [
    (True, "code", "Read", {"file_path": f"{ROOTS['code']}/web/src/lib/db.ts"}), (True, "code", "Read", {"file_path": "web/src/lib/db.ts"}), (True, "code", "Grep", {"pattern": "x"}),
    (False, "code", "Read", {"file_path": "web/node_modules/../../docs/agent-reports/code/REPORT.md"}), (False, "code", "Grep", {"pattern": "x", "path": "web/node_modules/../.."}),
    (False, "code", "Read", {"file_path": os.path.expanduser("~/.claude/projects/-x-AI-AMS--review-security/s/tool-results/a.txt")}), (False, "code", "Read", {"file_path": os.path.expanduser("~/.claude/projects/-x-AI-AMS--review-code/memory/MEMORY.md")}),
    (True, "code", "Read", {"file_path": os.path.expanduser("~/.claude/projects/-x-AI-AMS--review-code/s/tool-results/a.txt")}),
    (False, "code", "Read", {"file_path": "/x/AI AMS/docs/agent-reports/security/REPORT.md"}), (False, "code", "Read", {"file_path": f"{ROOTS['code']}/../ux/docs/agent-reports/ux/REPORT.md"}),
    (False, "code", "Grep", {"pattern": "x", "path": "/x/AI AMS"}), (False, "code", "Glob", {"pattern": "../*/REPORT.md"}), (False, "ux", "Read", {"file_path": "~/.claude/CLAUDE.md"}),
    (False, "code", "Read", {"file_path": "web/.env.local"}), (True, "code", "Read", {"file_path": "web/.env.example"}), (False, "code", "Write", {"file_path": "web/a"}), (False, "code", "Agent", {"prompt": "hi"}),
]
bad = 0
for want, agent, cmd in CASES:
    if bash(agent, cmd) != want:
        bad += 1; print(f"WRONG ({'should allow' if want else 'should refuse'}) [{agent}] {cmd}")
for want, agent, tool, inp in TOOLS:
    if run(agent, tool, inp) != want:
        bad += 1; print(f"WRONG ({'should allow' if want else 'should refuse'}) [{agent}] {tool} {inp}")
print(f"{len(CASES) + len(TOOLS) - bad} of {len(CASES) + len(TOOLS)} guard checks correct")
sys.exit(1 if bad else 0)
