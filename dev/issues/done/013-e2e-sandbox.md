# make e2e: disposable systemd containers
Opened: 2026-10-13
Closed: 2026-10-14
Status: done
Priority: urgent
Labels: gate-1, gate-2

PRD §0, gate 1–2. Clean container with systemd → installer → first issue closed by the worker < 30 min, 3 consecutive runs. Debian 13 + Ubuntu 24.04, amd64 + arm64 (emulated). Claude credentials mounted read-only.

- [x] `tests/e2e/` images + runner
- [x] (HITL?) arm64 binfmt on the PC (registration needs root)

Acceptance: 3 green runs per distro/arch logged in `dev/e2e-log.md`.

## Progress

- 2026-10-14: Debian 13 amd64: many green runs (first-issue 3/3, security, brain, vaultwarden, video, contract). Ubuntu 24.04 amd64: security, first-issue, smoke green. arm64 (qemu, owner decision: emulation with the limit stated): binfmt restored after Docker's VM restart (the harness now checks it first); install 14 min and unit tests pass; `appetito-tracker.service` restarts in a loop under qemu (exit 0, NRestarts 325) while the same command with the same environment via `systemd-run` stays up; `LockPersonality` ruled out; journald is empty under qemu, cause not found. README says so. Owner: real arm64 hardware if you want the services verified.
- 2026-10-14: Ubuntu 24.04 amd64 now 4 green (security, first-issue, smoke x2); Debian 13 amd64 well over 3. arm64 is the stated exception (owner decision 2026-10-14: emulation only, limit in the README): no green service run under qemu. Closed with that exception.
