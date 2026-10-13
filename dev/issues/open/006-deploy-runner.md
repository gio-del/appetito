# Deploy runner, checks, rollback, merge gate, protected paths
Opened: 2026-10-13
Blocked on: -
Status: todo
Priority: urgent
Labels: gate-3, guard

PRD §4.2–4.5. Root-owned fixed runner (systemd) that fetches agent branches, enforces branch policy, merges (gate `auto` | `approve`), applies known dirs, runs checks, rolls back on failure and opens a monitor issue.

- [ ] `guard/PROTECTED` + branch policy (guard paths → wait for tap; no edits to `issues/proposed/`, `Approved:`, `Source:`)
- [ ] Declarative service apply (`services/<name>/`): system user, dirs, validated units (never root, only `CAP_NET_BIND_SERVICE`), apt packages
- [ ] Rollback to previous applied commit (revert, never rewrite history) + monitor issue
- [ ] Tests: (b) guard change doesn't auto-merge, (c) proposal never runs without approval, (d) broken deploy rolls back

Acceptance: those tests green in the sandbox.
