# Off-site backup of the vault and service data

> Not yet run end to end in appetito's own e2e sandbox (Vaultwarden, #001, is). It should work; if the agent struggles, refine this text.

Opened: 2026-10-13
Blocked on: -
Status: backlog
Priority: high
Labels: backup, security

If this box dies, nothing important should die with it: the vault and every service's data get an encrypted copy somewhere else.

## What
- A service `offsite-backup` with a daily timer that collects the encrypted backups the services already make (`/var/lib/*/backups/*.age`) plus an `age`-encrypted archive of the vault, and sends them to one destination the owner chooses:
  - another device over Syncthing (a send-only folder, tailnet only), or
  - an S3-compatible bucket or an SFTP host with [restic](https://restic.net) (repository password generated on the server, credentials provided by the owner).
- Everything is encrypted on this server before it leaves; the destination never sees plaintext. Retention: 7 daily, 4 weekly, 6 monthly.
- A restore test: a monthly job restores the latest backup into a temporary dir and checks it (database opens, files count), and a failure becomes a monitor issue.
- The data dirs it reads are other services': it gets read access through a group, never by running as root.

## Acceptance criteria
- A dry run with a local test destination backs up and restores (test in the repo).
- No credential in the repo; the unit runs as `offsite-backup` with `NoNewPrivileges=yes`.
- The monitor opens an issue if the last successful backup is older than 48 h.

## Steps
- [ ] Decide the destination with the owner: write the options in a `## For you` section and hand over
- [ ] (HITL) Choose the destination and provide its credentials in `/etc/appetito/services/offsite-backup/` (why: accounts are the owner's)
- [ ] Service folder, scripts, timer, restore test, monitor check
