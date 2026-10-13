# appetito — PRD

> A self-hosted second brain that evolves itself.

Decided with the owner in a grilling session on 2026-10-13 (Edge `ops` session). This file is the single source of truth for the first public release. Copy it into the new repo as `docs/PRD.md`, then split the work into `issues/` there.

## 0. Hard constraints

- **Separate repo** `~/Desktop/Projects/personal/appetito` on the PC, fresh history. Nothing in `~/home-server` or on the Edge is modified, deployed or restarted. `~/home-server` is a **read-only source** of code to extract and generalize.
- **Everything is tested in a sandbox on the PC** (disposable Debian/Ubuntu containers with systemd, rebuilt from scratch on every e2e run). No sandbox on the Edge: every 127.0.0.1 port there is reachable from the whole tailnet.
- **Nothing is pushed to GitHub** until the owner says go. The repo stays local.
- No personal values anywhere in the new repo (tailnet name, IPs, usernames, Wi-Fi, device serials, email). CI greps for them and runs a secret scanner over the whole history.

## 1. Product

`appetito` is a **seed**, not a maintained product: you clone it, it becomes yours, and an agent grows your home server from there by working through markdown issues. It ships with a second brain (an Obsidian-compatible vault, synced, sorted by an agent) that can propose work to the server.

- The core loop: **monitor / suggest / brain propose → the owner approves in the tracker → the worker implements, commits, deploys → the monitor verifies**.
- The owner's phone setup (rooted Motorola, Debian chroot) is the backstory, not the target. Target: any **Debian 13 / Ubuntu 24.04** box, **amd64 and arm64**, with **systemd**.
- Acceptance: a stranger with a clean Debian VM and an agent backend gets to see the worker close their first issue in **< 30 minutes**.
- No upgrade path from upstream: whoever wants upstream changes adds the remote and asks the agent to merge, like any other issue.

## 2. Scope of the seed

| In | Source in `~/home-server` (generalize, don't copy blindly) |
|---|---|
| Issue format + Shape rules | `issues/README.md` |
| Tracker (board, drawer, proposals Approve/Approve-to-backlog/Reject, relations, stale backlog, settings page, **live auto page**) | `device/edge/tracker/` |
| Worker (picks issues, attempts, quota gate, manual start) | `ops-auto`, `ops-auto-prompt.md`, `ops-auto-request`, `ops-auto-card` |
| Failure → issue | `hs-run`, `hs-runlog`, `hs-monitor`, `device/edge/tests/` |
| Lint + housekeeping + similarity | `issues-lint`, `issues-housekeep`, `issues-similar`, `issues-autocommit` |
| Daily proposals that learn from rejections | `ops-suggest`, `ops-suggest-index`, `ops-suggest-prompt.md`, `suggest-projects` |
| Settings | `hs-setting`, `tracker/settings.schema.json` |
| Second brain: vault + Syncthing + sorting job + proposals to the tracker | `brain-setup`, `brain-sort`, `brain-propose`, `vault-autocommit`, `brain/sort-prompt.md`, `brain/second-brain.md`, `brain-fw.sh` (idea: per-uid loopback firewall, rewrite for nftables/iptables on a normal host) |
| Calendar for brain (**optional, off by default**) | `radicale-setup`, `brain-cal`, `radicale/` |
| Security audit + port check | `scripts/security-audit`, `ports-check`, `tailscale/policy.template.hujson` |

Out: Remote Control interactive sessions (Claude-specific; brain is driven by writing notes in `Inbox/`, `#now`-style tag for urgency), Homepage cards, edge-watch, phone-apps, debloat, Android/chroot code, Uptime Kuma, rotate-secrets as-is.

**Starter backlog** shipped in `issues/` as `Status: backlog`, written to a high standard (acceptance criteria, security checks: localhost bind, dedicated user, no root, `setpriv` + `CAP_NET_BIND_SERVICE` when a low port is needed, backups encrypted with age):
1. Add Vaultwarden (password manager) with encrypted backup
2. Add AdGuard Home (LAN ad blocking)
3. Add a dashboard (Homepage) with system status
4. Add a CalDAV calendar (Radicale) wired to brain
5. Off-site backup of the vault and service data

The owner moves one to To do and the agent builds the home server. That is also the video.

## 3. Agent independence

Nothing outside the adapters may depend on a specific agent.

- **Contract**: an executable `agent-run` taking *prompt file, working dir, permission profile* (`read-only` | `edit-repo` | … — no profile ever grants sudo) and returning *exit code, a normalized transcript JSONL (tool category + status, never needed to parse vendor formats elsewhere), usage (tokens / cost if known / duration)*. The live page, run logs, quota gate and denied-action reporting all read the normalized transcript.
- **v1 adapters**: `claude-code` (headless `claude -p`, reliable) and an open one for any **OpenAI-compatible endpoint including local models** (opencode preferred; Ollama / llama.cpp / vLLM). **Backend configurable per job** (e.g. a local model for `brain-sort`, a strong one for the worker).
- Quota gate becomes generic (tokens / cost / runs per window), with the Claude `rate_limit_event` as one adapter-specific source.
- Honest claim for README and post: "works with Claude Code or any OpenAI-compatible endpoint, including a local model on your own machine". No quality promises for small local models. The owner's PC has CPU + integrated GPU only: test Ollama with a small model (e.g. qwen2.5-coder 1.5–3B) **only to prove the contract**, not issue-closing quality.

## 4. Security model (the OS enforces it, not the model)

There is no Claude auto-mode classifier to lean on any more.

1. The worker runs as an unprivileged user `agent`: **no sudo**, its own git worktree/branch.
2. **Deploy is a separate privileged step** (fixed root-owned runner, systemd), not the agent: applies known directories (units, config, scripts), runs checks (`security-audit`, `ports-check`, tests, health URLs). On failure: **automatic rollback** to the previous commit + an issue opened by the monitor.
3. **Merge gate default: `auto`** (merge + deploy when checks pass). Configurable to `approve`.
4. **Protected paths `guard/`**: deploy runner, checks, red list, the agent's sandbox/permissions, firewall rules, brain-sort fixed rules, and the protected-path list itself. A commit touching `guard/` **never auto-merges**: it waits on its branch and shows in the tracker as "Change to protections — needs your tap" with the diff. Everything else (tracker, worker, services, UI) can evolve in `auto`: the agent may improve its own engine but never loosen its own limits.
5. **Proposals (suggest, brain) always need the owner's tap**, even with `auto`. `auto` applies to approved issues and monitor issues only. Vault content is untrusted (prompt injection).
6. Network: `agent` and `brain` users reach only what they need (model endpoint, package mirrors for agent; tracker propose API + optional CalDAV for brain) via a per-uid firewall.
7. brain is its own user, no access to the server repo, fixed sorting rules root-owned; its run logs readable by brain only.
8. Red list in the prompt stays as a belt, not the braces.
9. Tracker keeps password login + Origin/Host checks + CSP even behind the VPN.

## 5. Network

- **Default: Tailscale** (installer asks for the auth key; everything listens on localhost; `tailscale serve` for HTTPS so the tracker installs as a PWA). Ship the policy template with `tests`.
- `--no-tailscale`: everything stays on 127.0.0.1, exposing it is the user's job (WireGuard, Cloudflare Tunnel…), documented.
- Syncthing: tailnet only (no global/local discovery, no relays, no NAT).

## 6. Language

- Code, README, docs, prompts, issue format: **English**.
- Tracker UI: i18n with `en` (default) and `it` (already translated), chosen in settings. **Not mentioned in the post.**
- Vault folder names configurable (English defaults); brain-sort answers in the note's language.

## 7. Repo, licence, name

- Name **`appetito`** — check that no notable GitHub project uses it before creating anything public.
- Licence **Apache-2.0**. Will live at `github.com/gio-del/appetito` (owner's personal account) — **only when the owner says go**.
- `SECURITY.md` (threat model, how to report). README disclaimer: "the agent modifies and deploys code on your server automatically; use a dedicated machine".
- `docs/android-phone.md`: how the owner runs it on an old phone (Debian chroot, userspace Tailscale, wake lock, uid ≥10000 firewall trap, kernel without Docker, no screen lock), **unsupported**, root **not** included ("ask your agent for your model; these were my traps"), and a warning that a vbmeta signed with the AOSP test key makes the phone a zero-trust device. Mention Claude sparingly.
- Dogfooding: once the seed runs in the sandbox, it may develop itself (`issues/` of the appetito repo).

## 8. Launch video

- Showcase quality (Linear / Raycast / Arc launch-video style), built **autonomously on the PC, free tools**: Playwright records the tracker in a phone viewport inside the sandbox, Remotion (free for individuals) composes, ffmpeg encodes.
- 1080×1920, 60 fps, 30–45 s, vertical for LinkedIn. Text carries it (most watch muted); royalty-free music with a clear licence and **no account needed**, otherwise skip music.
- Story: illustrated vector old phone "turning on" (3–4 s, "Avevo un telefono vecchio.") → floating phone mockup with the real recording: move *Add Vaultwarden* to To do → live ring, steps appearing (time-lapsed, "×16" overlay) → ✓ Closed → Vaultwarden opens → "appetito · open source" + link. Smooth zooms/pans on the action, kinetic typography, palette matching the UI.
- **Real run**, not a replay (a replay is allowed only for rehearsing framing/timing). Neutral issue titles, nothing from the owner's infra.
- Drafts are judged by the session; the owner sees the final candidate only.

## 9. LinkedIn post (draft, the owner publishes)

- One post, when the launch gate is green. Italian, opening line "🇬🇧 English in the first comment", English version for the first comment.
- Title **"L'appetito vien mangiando"**. Flow: I had an old phone → rooted it (turns out an AI agent can walk you through it) → installed a home server → turned it into a second brain that evolves itself → now open source, agent-independent, runs with local models too.
- Screenshots retaken in the sandbox (not the owner's real system).

## 10. Launch gate (all must be true before the post)

1. `make e2e` green: clean container → installer → first issue closed by the worker in < 30 min, **3 consecutive runs**.
2. Debian 13 and Ubuntu 24.04, **amd64 and arm64** (arm64 e2e under emulation is fine).
3. `security-audit` green in the sandbox, and tests proving: (a) `agent` can't sudo, (b) a commit touching `guard/` doesn't auto-merge, (c) a brain/suggest proposal never runs without approval, (d) a broken deploy rolls back.
4. Adapters: full e2e with Claude Code; Ollama adapter honours the contract.
5. Secret scanner over the whole history + CI grep for personal values: zero hits.
6. README: video/GIF, 5-command quickstart, security model section, phone guide link, what it does NOT do.
7. Starter issues tested; at least Vaultwarden actually closed by the agent.
8. `SECURITY.md`.
9. Disclaimer in README.
10. Video and post text approved by the owner.

## 11. How the PC session works (autonomy rules)

- Started by the owner once on the PC, in tmux, with Remote Control (`claude --remote-control appetito`), **auto mode, never bypass**. First steps: owner enables mobile push in `/config` (it was off on the Edge on 2026-10-13); the session sends a test push "appetito: sessione avviata" and checks the PC won't suspend.
- First task: `scp edge:appetito-handoff/PRD.md`, create `~/Desktop/Projects/personal/appetito`, `git init`, commit this as `docs/PRD.md`, split into issues (one per block of the launch gate / section), then work through them.
- Sandbox credentials: the PC's existing Claude Code credentials are mounted **read-only** into the disposable containers (no interactive `/login`).
- When an action is blocked by the classifier: record it in the issue as a `(HITL)` step, push-notify the owner with what to approve, and **move on to an independent block** (i18n, adapters, starter issues, README, video…). Never stall overnight.
- Push notifications only when blocked, when a launch-gate item completes, and at the end. Short, actionable, Italian.
- Never: ask for bypass, push to GitHub, touch the Edge or `~/home-server` (read-only reads are fine), buy or sign up for anything.
- Talk to the owner in Italian; the repo is in English.
