# Installer: Debian 13 / Ubuntu 24.04, amd64 / arm64
Opened: 2026-10-13
Blocked on: issue 006
Status: todo
Priority: urgent
Labels: gate-1

PRD §1, §5. `sudo ./install.sh` asks for the agent backend and (default) a Tailscale auth key; `--no-tailscale` keeps everything on 127.0.0.1. Idempotent.

- [ ] Users, dirs, node, git, jq, syncthing, units, tracker password
- [ ] Tailscale path with `tailscale serve` (HTTPS, PWA)

Acceptance: e2e green.
