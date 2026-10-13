# Daily proposals that learn from rejections
Opened: 2026-10-13
Blocked on: issue 003, issue 004
Status: todo
Priority: medium
Labels: core

Source: `ops-suggest`, `ops-suggest-index`, `ops-suggest-prompt.md`, `suggest-projects`. Runs read-only through `agent-run`, proposes only via the tracker token; daily limit; rejection reasons fed back.

- [ ] Port + generalize
- [ ] Test: a proposal lands in `proposed/` and is never picked by the worker

Acceptance: unit tests.
