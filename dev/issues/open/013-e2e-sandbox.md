# make e2e: disposable systemd containers
Opened: 2026-10-13
Blocked on: issue 012
Status: todo
Priority: urgent
Labels: gate-1, gate-2

PRD §0, gate 1–2. Clean container with systemd → installer → first issue closed by the worker < 30 min, 3 consecutive runs. Debian 13 + Ubuntu 24.04, amd64 + arm64 (emulated). Claude credentials mounted read-only.

- [ ] `tests/e2e/` images + runner
- [ ] (HITL?) arm64 binfmt on the PC (registration needs root)

Acceptance: 3 green runs per distro/arch logged in `dev/e2e-log.md`.
