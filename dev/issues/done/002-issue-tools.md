# Issue format and tools: lint, housekeep, similar, autocommit
Opened: 2026-10-13
Closed: 2026-10-13
Blocked on: -
Status: todo
Priority: high
Labels: core

PRD §2 rows 1, 4. Source: home-server `issues/README.md`, `issues-lint`, `issues-housekeep`, `issues-similar`, `issues-autocommit`.

- [x] `issues/README.md` (English, generalized; Shape rules; `Approved:` header written only by the tracker)
- [x] Port tools to `core/issues/`, no personal paths, configurable repo path
- [x] Unit tests on fixture repos

Acceptance: tests green; lint turns violations into `monitor` issues.

## Done (2026-10-13)
`issues/README.md` rewritten for appetito (proposals wait in the tracker, `Approved:` written only by it). Tools: `guard/tracker/issues.js` (parser, housekeep, lint, similarity; shared with the tracker server), wrappers in `core/issues/`. Housekeeping runs in the tracker after every edit and in the monitor every 5 minutes; autocommit is the deploy runner's (root, issues only, refuses `Approved:`/`Source:` changes not written by the tracker). Tests: `guard/tracker/issues.test.js`, `core/monitor/monitor.test.js`.
