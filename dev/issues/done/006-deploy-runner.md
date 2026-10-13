# Deploy runner, checks, rollback, merge gate, protected paths
Opened: 2026-10-13
Closed: 2026-10-13
Blocked on: -
Status: todo
Priority: urgent
Labels: gate-3, guard

PRD §4.2–4.5. Root-owned fixed runner (systemd) that fetches agent branches, enforces branch policy, merges (gate `auto` | `approve`), applies known dirs, runs checks, rolls back on failure and opens a monitor issue.

- [x] `guard/PROTECTED` + branch policy (guard paths → wait for tap; no edits to `issues/proposed/`, `Approved:`, `Source:`)
- [x] Declarative service apply (`services/<name>/`): system user, dirs, validated units (never root, only `CAP_NET_BIND_SERVICE`), apt packages
- [x] Rollback to previous applied commit (revert, never rewrite history) + monitor issue
- [x] Tests: (b) guard change doesn't auto-merge, (c) proposal never runs without approval, (d) broken deploy rolls back

Acceptance: those tests green in the sandbox.

## Done (2026-10-13)
`guard/bin/appetito-deploy` (+ `appetito-apply` logic inside, `appetito-checks`, `appetito-issue`), `guard/checks/{branch-policy,unit-lint.js,security-audit,ports-check}`. Unit tests: `tests/unit/branch-policy.sh`, `guard/checks/unit-lint.test.js`. e2e: `tests/e2e/run --scenario security` green 2026-10-13 (b, c, d through the real worker and runner). See `dev/e2e-log.md`.
