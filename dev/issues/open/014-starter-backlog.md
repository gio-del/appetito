# Starter backlog
Opened: 2026-10-13
Blocked on: -
Status: todo
Priority: high
Labels: gate-7

PRD §2. Five issues in `issues/open/`, `Status: backlog`, high standard (acceptance criteria, security checks).

- [x] Vaultwarden, AdGuard Home, Homepage, Radicale wired to brain, off-site backup
- [ ] Each tested in the sandbox; Vaultwarden actually closed by the agent

Acceptance: gate 7.

## Progress

- 2026-10-14: Vaultwarden (#001) actually closed by the agent in the e2e (debian13 amd64, Sonnet): first pass built the service (pinned binary + web vault with SHA-256s, hardened unit, age-encrypted nightly backup, tests), deploy merged, `/alive` 200, web vault served; handed over with the two (HITL) steps (age key, `tailscale serve`); after the owner's part the agent closed it. Fixes found on the way: worker conflict on `Status:` (issueOnMain), flaky tracker test (5 s start wait). `tests/e2e/run --scenario vaultwarden` now plays the owner's turn from `tests/e2e/owner/001.sh`.
- Left: a full uninterrupted vaultwarden run (do it while recording the video, step 6 of the handoff); AdGuard Home, Homepage, Radicale, off-site backup in the sandbox (each needs a scenario like `vaultwarden`, plus an owner script if it has (HITL) steps).
