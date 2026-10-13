# Add a CalDAV calendar (Radicale) wired to the second brain

Opened: 2026-10-13
Blocked on: -
Status: backlog
Priority: medium
Labels: service, brain

A private calendar and task list that sync to the phone (DAVx⁵ on Android, the built-in Calendar on iOS), and that the second brain fills from notes in the vault's Inbox.

## What
- A service `radicale` running [Radicale](https://radicale.org) (Debian package `radicale` or a pinned release) on `127.0.0.1:5232`, data in `/var/lib/radicale`.
- Two accounts: the owner's, and `brain` with rights limited to items inside two collections of the owner (`calendar`, `tasks`): it can add and edit events and tasks, never delete collections or read anything else.
- Passwords generated at first start (bcrypt htpasswd); the brain's in `/etc/appetito/secrets/brain-caldav` (readable by brain only — the agent can't write there: a `(HITL)` step gives the exact `install` command).
- `APPETITO_CALDAV_URL=http://127.0.0.1:5232/<owner>` in `/etc/appetito/appetito.env` turns on `brain-cal` (`core/brain/bin/brain-cal`), and the brain's firewall must let it reach port 5232 (`APPETITO_BRAIN_LOOPBACK_PORTS=5232`): both are root settings, a `(HITL)` step.
- A nightly backup encrypted with `age` like Vaultwarden's.

## Acceptance criteria
- `brain-cal add tasks <file>` as brain creates a task; deleting the collection as brain is refused (a probe).
- Health URL answers; `ports-check` sees only `127.0.0.1:5232`.

## Steps
- [ ] Service folder, rights file, unit, backup, probe
- [ ] (HITL) Put the brain's CalDAV password in place and set `APPETITO_CALDAV_URL` and `APPETITO_BRAIN_LOOPBACK_PORTS` (commands written here)
- [ ] (HITL) Add the account on the phone (DAVx⁵ / iOS Settings → Calendar → Accounts), using the address published with Tailscale
