# Optional CalDAV calendar for brain (off by default)
Opened: 2026-10-13
Closed: 2026-10-14
Status: done
Priority: low
Labels: core

Source: `radicale-setup`, `brain-cal`, `radicale/`. Note: the starter backlog issue "Add a CalDAV calendar" is the agent-built path; this issue only ships the brain side (`brain-cal`) that activates when a CalDAV URL is configured.

- [x] `brain-cal` generalized, disabled unless configured

Acceptance: off by default; unit test.

## Progress

- 2026-10-14: Unit test `tests/unit/brain-cal.sh`: off unless `APPETITO_CALDAV_URL` is set, loopback only, add/edit against a stand-in CalDAV server (existing UID refused, edit needs one), items validated. Checked by mutation (dropping If-None-Match fails it). Closed.
