# Add Vaultwarden (password manager) with encrypted backup

Opened: 2026-10-13
Blocked on: -
Status: backlog
Priority: high
Labels: service, security

A self-hosted password manager compatible with the Bitwarden apps, so passwords live on this server instead of a cloud.

## What
- A service `vaultwarden` (`services/vaultwarden/`, see `services/README.md`) running [Vaultwarden](https://github.com/dani-garcia/vaultwarden) with its web vault, listening on `127.0.0.1:8222` only.
- There is no Debian package and no official binary: the service's own user fetches a pinned release (for example the static binary inside the official `-alpine` image, plus the web vault from `dani-garcia/bw_web_builds`) in an `ExecStartPre=` script, checks pinned SHA-256s, and skips the download when the right version is already in `/var/lib/vaultwarden`. amd64 and arm64.
- Data in `/var/lib/vaultwarden` (SQLite). Signups closed after the first account: the first signup is the owner's.
- A nightly backup: a consistent copy of the database (`sqlite3 .backup`), attachments and keys, packed and encrypted with `age` to the public key in `/etc/appetito/services/vaultwarden/backup.age.pub`, kept 14 days in `/var/lib/vaultwarden/backups/`. Never an unencrypted copy on disk outside the data dir.
- HTTPS: the Bitwarden apps need it. With Tailscale, publish it with `tailscale serve` on its own port is a privileged step: write the exact command in a `(HITL)` step for the owner.

## Acceptance criteria
- `HEALTH=http://127.0.0.1:8222/alive` answers after the deploy, and the deploy runner's checks pass (`ports-check` sees only `127.0.0.1:8222`).
- The unit runs as `vaultwarden`, with `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/vaultwarden`, `PrivateTmp=yes`.
- The backup timer produces an `.age` file that decrypts (tested with a throwaway key in a test, never with the owner's key) and contains the database.
- No secret in the repo: the admin token, if any, is generated at first start into `/var/lib/vaultwarden` (mode 600), or left disabled.

## Steps
- [ ] Service folder, fetch script with pinned versions and checksums, unit, backup script and timer
- [ ] Tests for the fetch script (checksum mismatch refuses) and the backup (encrypt/decrypt round trip with a test key)
- [ ] (HITL) Put your age public key in `/etc/appetito/services/vaultwarden/backup.age.pub` (the private key stays with you)
- [ ] (HITL) With Tailscale: publish HTTPS for the apps with the `tailscale serve` command the agent writes here (needs root)
