# appetito — context for Claude

`appetito` is a seed for a self-evolving home server with a second brain. `docs/PRD.md` is the single source of truth for the first public release; `docs/architecture.md` explains how the pieces fit.

## Rules for working on this repo

- Repo language is **English** (code, docs, prompts, issues). Talk to the owner in **Italian**.
- **Published** at github.com/gio-del/appetito (2026-10-14, owner's go). Push only when the owner asks; `make check` must be green first (it scans the whole history).
- **No personal values** (tailnet names, IPs, usernames, Wi-Fi names, device serials, emails) anywhere in the repo. `make check` runs `scripts/check-personal` (hashed denylist) and a secret scanner over the whole history.
- The owner's `home-server` repo is a **read-only source**: extract and generalize, never modify it, never touch the Edge.
- Everything runs and is tested in **disposable containers on the PC** (`make e2e`), never on the host system and never on the Edge.
- Commit messages carry no AI attribution.

## Two issue folders, don't mix them

- `dev/issues/{open,done}/` — the seed's own development work (launch gate). Same format as below. This is where you track your work on this repo.
- `issues/{open,done,proposed}/` — what ships to users: the issue format README and the **starter backlog** (`Status: backlog`). Don't put development work there.

Workflow: before starting, read `dev/issues/open/`; keep the issue you work on current (dated progress, `Blocked on:`); when done `git mv` it to `dev/issues/done/` with `Closed: YYYY-MM-DD`. Owner steps are `- [ ] (HITL) … (why)`.

## Layout

- `guard/` — protected paths: deploy runner, checks, agent permission profiles + `agent-run`, red list, firewall, brain fixed rules, `guard/PROTECTED`. A change here never auto-merges.
- `core/` — tracker, worker, monitor, issue tools, suggest, brain jobs, settings. The agent may evolve these.
- `services/` — one folder per service the agent adds to a user's server.
- `install.sh` — installer. `tests/` — unit tests and the container e2e.
