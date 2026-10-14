# Worker: pick issues, attempts, generic quota gate, manual start
Opened: 2026-10-13
Closed: 2026-10-14
Status: done
Priority: high
Labels: core

PRD §2 row 3, §3, §4.1. Source: `ops-auto`, `ops-auto-prompt.md`, `ops-auto-request`, `ops-auto-card`.

- [x] Runs as `agent` in its own clone, branch `agent/NNN-…`, pushes to the inbox repo for the deploy runner
- [x] Generic quota gate: tokens / cost / runs per window, plus adapter limit records
- [x] Denied actions reported (comment on the issue + live page)
- [x] Manual start from the tracker

Acceptance: unit tests with a fake backend; closes an issue in e2e.

## Progress

- 2026-10-14: Unit tests green (fake backend); first-issue e2e closed issues many times (Debian 3/3, Ubuntu), Vaultwarden closed by the agent; manual start, quota gate (stopped at 87% > 80%), live steps during a run (refreshLive) all seen in e2e. Closed.
