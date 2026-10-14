# How the worker runs (core/worker/prompt.md)

You get exactly one issue. Read `CLAUDE.md` or `AGENTS.md` if present, `issues/README.md`, `docs/architecture.md` and `services/README.md` before changing anything. Keep runs small: the smallest change that does the issue, no unrelated refactors.

## Your branch
You are on `agent/<issue>-…` in a clone of the server repo. Commit your work there (clear messages, no AI attribution). When you finish, the worker pushes the branch and the deploy runner merges it, applies it and runs the checks (`tests/run-unit`, `security-audit`, `ports-check`, each service's `HEALTH` URL). If a check fails your change is rolled back and a `monitor` issue tells the next run why. So:
- Run `tests/run-unit` and any test you add before you commit.
- Your clone lacks the `APT=` packages a service declares; the runner runs your tests on the server after installing them. A test that falls back to a stand-in when a tool is missing must pass with the real tool too: compare what matters (rows from a query, a file list), never the bytes of files the real tool writes (an SQLite `.backup` copy, an archive with timestamps).
- A new service: a folder `services/<name>/` with `service.env` and its systemd units, as `services/README.md` explains (`guard/checks/unit-lint.js .` must pass). Test what you can locally as `agent` (your files, your ports on 127.0.0.1).
- You can't see the running system's privileged state; write the issue's verification steps as checks the runner or the monitor can run (health URL, a probe in `tests/probes/`).

## Writing issues
Follow the "Shape rules" in `issues/README.md`: epics hold no `- [ ]` work; every open issue has a `Status:`; owner steps are `- [ ] (HITL) … (why)` and never hide steps you could do; dependencies are `Blocked on: issue NNN`. Before creating an issue, search for one that already covers it (`core/issues/issues-similar "TITLE" "BODY"`).

## How to finish (always one of these, then commit)
1. **Done**: the issue's work is in the repo and you verified what you can. Add a short dated section (what you did, how it is verified), `git mv` the file to `issues/done/`, add `Closed: YYYY-MM-DD` under `Opened:`. The deploy runner's checks are the final verification.
2. **Handed over**: set `Blocked on: user (<short reason>)` and add a section `## For you (YYYY-MM-DD)` with what you found and the exact steps for the owner, written for a phone (menu paths and button labels; no shell commands unless a real terminal is needed).
3. **Partial**: real progress but not finished: a dated progress section with the exact next step, `Status: in-progress`. The next run continues.

End your reply with one line: `#NNN: <outcome>`.
