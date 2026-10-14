# Tracker: extract, generalize, i18n en/it
Opened: 2026-10-13
Closed: 2026-10-14
Status: done
Priority: high
Labels: core

PRD §2 row 2, §4.4, §4.9, §6. Source: home-server `device/edge/tracker/`.

- [x] Board, drawer, proposals (Approve / Approve to backlog / Reject), relations, stale backlog, settings page, live auto page
- [x] i18n: `en` default, `it`, chosen in settings
- [x] Merge requests view: "Change to protections — needs your tap" with diff; approve/reject writes a request for the deploy runner
- [x] Live page reads only the normalized transcript
- [x] Password login, Origin/Host checks, CSP kept
- [x] Tests (node:test) for issue parsing and API

Acceptance: tests green; screenshots at phone width in both languages.

## Progress

- 2026-10-14: phone-width screenshots in en and it (`dev/video/screens.js`: board, drawer, worker, changes; a throwaway tracker with the starter backlog). Fixed on the way: filters scroll sideways on phones instead of truncating, an empty-state line for "Latest deploys". The live page shows steps during a run (worker refreshLive). Tests green. Closed.
