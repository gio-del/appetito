# Installer: Debian 13 / Ubuntu 24.04, amd64 / arm64
Opened: 2026-10-13
Closed: 2026-10-14
Status: done
Priority: urgent
Labels: gate-1

PRD §1, §5. `sudo ./install.sh` asks for the agent backend and (default) a Tailscale auth key; `--no-tailscale` keeps everything on 127.0.0.1. Idempotent.

- [x] Users, dirs, node, git, jq, syncthing, units, tracker password
- [x] Tailscale path with `tailscale serve` (HTTPS, PWA)

Acceptance: e2e green.

## Progress

- 2026-10-14: e2e green on Debian 13 and Ubuntu 24.04 amd64 (install ~1 min). The Tailscale path (`tailscale serve`, HTTPS/PWA) is written but not exercised by the e2e (no tailnet in a box): the owner checks it on the first real install. Closed.
