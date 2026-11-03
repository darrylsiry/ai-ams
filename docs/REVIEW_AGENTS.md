# Independent review agents

Four Claude agents review siryous AMS, modeled on the framework in the Underwriting Desktop. Each has
one purpose and works alone. Their reports appear at **Admin > App Tests**, for administrators only.

| Agent | Purpose | Report | IDs | Run it |
|---|---|---|---|---|
| `code-auditor` | Bugs and code quality | `docs/agent-reports/code/REPORT.md` | `CR-001` | `scripts/review-run.sh code` |
| `security-reviewer` | Vulnerabilities and insecure configuration | `docs/agent-reports/security/REPORT.md` | `SEC-001` | `scripts/review-run.sh security` |
| `ux-reviewer` | Usability, with before/after mockups | `docs/agent-reports/ux/REPORT.md` | `UX-001` | `scripts/review-run.sh ux` |
| `uat-tester` | Every function end to end, as a user | `docs/agent-reports/uat/REPORT.md` | `UAT-F1` | `scripts/review-run.sh uat` |

The slash commands `/audit`, `/security-audit`, `/ux-audit` and `/uat` run the same thing. A run is
skipped when the code it covers has not changed. Add `force` to run anyway. `scripts/review-run.sh all`
runs all four at once, each in its own process.

## How independence is enforced

The Underwriting Desktop asks most of its agents, by instruction, to stay independent. Here the setup
makes that the default.

1. **Own snapshot.** `scripts/review-run.sh` copies the code to `.review/<agent>/`, with only that
   agent's definition and its own previous report. No other agent's report, definition or mockups, no
   ledger, no memory and no secrets are in it. What isn't there can't bias it.
2. **Own process.** Each run is a fresh `claude -p` started in the snapshot with a scrubbed environment,
   auto-memory off, project settings only, no MCP servers, no session history, and only Read, Grep, Glob
   and Bash. No tool reaches another agent.
3. **A guard on every tool call.** `scripts/review-guard.py` refuses paths outside the snapshot, memory
   and transcripts, `/admin/app-tests`, starting another agent, and anything that writes. It fails
   closed. `python3 scripts/review-guard-test.py` checks it.
4. **Results meet only after the agents finish.** The runner saves each final message word for word and
   folds it into `docs/agent-reports/AGENT_LEDGER.json`. Only the App Tests page reads across agents, and
   no agent can reach it: the guard refuses the URL, and the UAT sandbox runs with no reports at all.

An agent's only link to the past is its own previous report, so it can keep finding IDs stable.

5. **The operating system.** On a Mac the run is wrapped in `sandbox-exec`, so the agent and anything it
   starts can read only its snapshot and the parts of the home folder its tools need. The repository, memory,
   transcripts and other tools' credentials are refused. Network stays open: the profile can't allow a single
   host, and the UAT agent needs the live site. Elsewhere only the guard applies, and the run says so.

The guard is a deny-list, and a determined program could get past it on its own, which is why the snapshot
and the sandbox come first. Also, the agent definitions are in this
repository and written by the same hand as the code. Independence covers their findings, not their brief.

## Safety on production

Only `uat-tester` touches a running site beyond the local app. `scripts/uat.sh` runs writing flows only in
a disposable Docker project (`siryous-ams-uat`, port 3950) and sends the live site a read-only suite whose
guard aborts anything but a GET. A canary pass proves on the sandbox that the read-only suite changes no
data. Without a `uat=` line in `.fly-credentials`, the live pass runs only its signed-out checks. To add
that login:

```bash
scripts/fly-users.sh uat
```

## Using the reports

Coding agents fix items top-down and cite the ID. Agents mark items resolved when they see the fix. A
person may change a security finding's status to `Accepted`, or a UX finding's to `Declined`, with a
reason. Reports and history reach the live App Tests page on the next `scripts/fly-deploy.sh`.
