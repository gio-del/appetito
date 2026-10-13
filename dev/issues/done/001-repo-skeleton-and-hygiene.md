# Repo skeleton, licence, hygiene checks
Opened: 2026-10-13
Closed: 2026-10-13
Blocked on: -
Status: todo
Priority: urgent
Labels: gate-5

PRD §0, §7, gate 5.

- [x] Apache-2.0 `LICENSE`, `.gitignore`, `Makefile` (`check`, `test`, `e2e`)
- [x] `scripts/check-personal`: tokenizes every tracked file + every commit message in history and compares sha256 against `scripts/personal.sha256` (values never stored in clear)
- [x] Secret scanner over the whole history (gitleaks in a container) in `make check`
- [x] CI workflow (`.github/workflows/ci.yml`) running `make check test` (inert until pushed)

Acceptance: `make check` green with zero hits; a planted value is caught.

## Done (2026-10-13)
`make check` = `scripts/check-personal` (sha256 denylist over every blob in history, the worktree and commit metadata; a planted value was caught) + gitleaks v8.18.4 over the whole history + shellcheck. Commits use the GitHub noreply identity (`git config user.email` set locally; the first 3 commits were rewritten before anything was pushed). Plaintext denylist lives outside the repo in `~/.config/appetito-dev/personal-values.txt`.
