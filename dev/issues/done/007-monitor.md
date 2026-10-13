# Monitor: failure → issue
Opened: 2026-10-13
Closed: 2026-10-13
Blocked on: -
Status: todo
Priority: medium
Labels: core

Source: `hs-run`, `hs-runlog`, `hs-monitor`, `device/edge/tests/`.

- [x] `appetito-run` wrapper for every job, run logs with retention
- [x] Monitor probes (jobs, units, health URLs, `tests/probes/*`) → `monitor` issues, deduplicated, auto-closed when green

Acceptance: unit tests; in e2e a failing job produces one issue.

## Done (2026-10-13)
`core/monitor/monitor.js` (+ `appetito-run`, `appetito-runlog`, units). Unit tests green; the e2e check (a failing job produces one issue) is part of issue 013.
