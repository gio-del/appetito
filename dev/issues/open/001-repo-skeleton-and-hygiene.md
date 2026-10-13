# Repo skeleton, licence, hygiene checks
Opened: 2026-10-13
Blocked on: -
Status: todo
Priority: urgent
Labels: gate-5

PRD §0, §7, gate 5.

- [ ] Apache-2.0 `LICENSE`, `.gitignore`, `Makefile` (`check`, `test`, `e2e`)
- [ ] `scripts/check-personal`: tokenizes every tracked file + every commit message in history and compares sha256 against `scripts/personal.sha256` (values never stored in clear)
- [ ] Secret scanner over the whole history (gitleaks in a container) in `make check`
- [ ] CI workflow (`.github/workflows/ci.yml`) running `make check test` (inert until pushed)

Acceptance: `make check` green with zero hits; a planted value is caught.
