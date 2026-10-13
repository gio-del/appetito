# Worker: pick issues, attempts, generic quota gate, manual start
Opened: 2026-10-13
Blocked on: issue 003
Status: todo
Priority: high
Labels: core

PRD §2 row 3, §3, §4.1. Source: `ops-auto`, `ops-auto-prompt.md`, `ops-auto-request`, `ops-auto-card`.

- [ ] Runs as `agent` in its own clone, branch `agent/NNN-…`, pushes to the inbox repo for the deploy runner
- [ ] Generic quota gate: tokens / cost / runs per window, plus adapter limit records
- [ ] Denied actions reported (comment on the issue + live page)
- [ ] Manual start from the tracker

Acceptance: unit tests with a fake backend; closes an issue in e2e.
