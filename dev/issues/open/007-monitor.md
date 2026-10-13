# Monitor: failure → issue
Opened: 2026-10-13
Blocked on: -
Status: todo
Priority: medium
Labels: core

Source: `hs-run`, `hs-runlog`, `hs-monitor`, `device/edge/tests/`.

- [ ] `appetito-run` wrapper for every job, run logs with retention
- [ ] Monitor probes (jobs, units, health URLs, `tests/probes/*`) → `monitor` issues, deduplicated, auto-closed when green

Acceptance: unit tests; in e2e a failing job produces one issue.
