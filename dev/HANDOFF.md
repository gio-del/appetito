# Handoff (2026-10-13, end of the first PC session; updated at the end of the second)

## Owner decisions (2026-10-14) — work autonomously within these

- **arm64**: emulation (qemu) with the limit stated: install, unit tests and services checked under emulation, firewall checks skipped there; README says arm64 is tested under emulation only.
- **Quota**: agent e2e runs while the Pro five-hour window is under **80%**; above it, do quota-free work and resume after the reset.
- **Starter issues**: only Vaultwarden must be proven before launch; the other four stay in the backlog marked "not yet tested".
- **History rewrite (019)**: allowed at the end, autonomously, after a full `git bundle` backup outside the repo; then `make check` must show zero hits. Never push.
- Owner approval still needed for: video + post (show only the final candidate), and the go to publish.

## Third session (2026-10-14, morning) in short

- Disk freed with the owner (19 GB free). arm64 binfmt installed in Docker Desktop (`tonistiigi/binfmt:qemu-v8.1.5 --install arm64`; lost when the VM restarts).
- **Vaultwarden closed by the agent** (gate 7): the worker fix held (no conflict); a flaky tracker test (5 s server start) rolled back one deploy — fixed (30 s, reports why); the issue was handed with (HITL) steps, the harness now plays the owner (`tests/e2e/owner/001.sh`, `in-box.sh owner-done`) and the agent then closed it.
- Ubuntu 24.04 amd64 security PASS. **arm64 can't be proven under qemu**: no netfilter Netlink (`nft`: Protocol not supported), installs take 14 min. Owner to choose: real arm64 hardware (not the Edge), a cloud arm64 VM, or emulation with the firewall checks skipped and the limit stated.
- Next: video run (step 6) = the full uninterrupted vaultwarden run with the owner turn; first-issue on Ubuntu (gate 2, uses quota).

## Second session (2026-10-13, evening) in short

- Fixed: the brain firewall flake (`| grep -q` under pipefail; lint now refuses it). First-issue 3/3 green on Debian 13 amd64. Brain e2e scenario added and green (dev issue 009 closed). Ollama contract green (`tests/contract/ollama.sh`).
- Vaultwarden run: the agent's work was fine, but the deploy **conflicted**: the worker started from main before the tracker's move to To do (Status: line) was committed. Fixed in the worker (`issueOnMain`: the issue must be in HEAD and identical to the tracker's copy), unit-tested, **not yet proven by an e2e**. Rerun `--scenario vaultwarden` first.
- Then the worker stopped on its own quota gate: the Pro five-hour window was at 69% (cap 50%), reset ~02:50. Agent e2e runs wait for it.
- Ubuntu 24.04 amd64: security PASS. arm64: the image doesn't build, `exec format error` (no binfmt/qemu in Docker Desktop's VM right now). Needs `docker run --privileged --rm tonistiigi/binfmt --install arm64` (owner's call).
- **Disk**: 2.9 GB free after the Ollama runs (Docker.raw 71 GB, doesn't shrink). No more container work until the owner frees space.


Read first: `CLAUDE.md`, `docs/PRD.md` (§10 launch gate, §11 autonomy rules), `docs/architecture.md`, `SECURITY.md`, `dev/issues/open/`. Talk to the owner in Italian; the repo is English; nothing is pushed (no remote); commits use the noreply identity already set in `.git/config`.

## State of the launch gate (PRD §10)

| # | Item | State |
|---|---|---|
| 1 | first issue < 30 min, 3 consecutive | **Green**: Debian 13 amd64 3/3 (≈1.5 min each); Ubuntu 24.04 too. |
| 2 | Debian 13 + Ubuntu 24.04, amd64 + arm64 | **Green on amd64** (both distros, many runs). arm64: owner decision, emulation only: install + unit tests pass, services not verified under qemu (README says so). |
| 3 | security-audit + tests (a)-(d) | **Green** (Debian, Ubuntu). |
| 4 | Claude Code e2e; Ollama honours the contract | **Green**: contract ok for claude-code and openai/Ollama (dev 003 closed). |
| 5 | Secret scan + personal values, whole history | Tree clean; history has the known false positive → dev 019, right before the go (owner allowed it, with a bundle backup). |
| 6 | README | **Done**, with `docs/media/demo.gif` from the video. |
| 7 | Starter issues; Vaultwarden closed by the agent | **Done** (owner: only Vaultwarden proven; 002-005 marked untested). |
| 8 | SECURITY.md | Done. |
| 9 | Disclaimer | Done. |
| 10 | Video + post approved by owner | **Final candidates sent 2026-10-14**: `dev/video/out/appetito-launch.mp4` (41 s, real run), `dev/launch/post.md` + `dev/launch/media/`. Waiting for the owner. |

Dev issues closed: 001, 002, 006, 007, 008, 011, 016. Open: 003 (agent-run: Ollama real run left), 004 (tracker: mostly done — close after a last UI pass), 005 (worker: done in practice, close with the e2e), 009 (brain: code done, needs an e2e — a note in Inbox gets sorted and proposes), 010 (calendar: `brain-cal` done, off unless configured), 012 (installer: done, needs ubuntu/arm64), 013 (e2e), 014 (starter backlog: Vaultwarden run), 015 (docs: gif), 017, 018, 019.

## Fixed bug (2026-10-13)

`no firewall rules for brain` was `| grep -q` under `pipefail` (SIGPIPE race), fixed everywhere and refused by `make lint`.

## Things learned this session (don't relearn)

- **Disk**: the PC's root is tight; Docker Desktop's `~/.docker/desktop/vms/0/data/Docker.raw` (56 GB) never shrinks. One container at a time; remove images/volumes you create; `df -h /` before pulling big things. Never "Purge data" (the owner's sumisura volumes). See auto-memory `project_pc_disk_docker_raw`. If Claude Code's temp dir fills, write command output to `/dev/shm/x.txt` and Read it.
- Docker Desktop only mounts paths under `$HOME` (use `~/.cache/appetito-dev/`, not the scratchpad), and `docker cp` into `/tmp` of a systemd container is invisible (tmpfs): use `/root`.
- `bash -c '…rm…'` via docker exec can be blocked by the safety check: use direct commands.
- Bash `set -o pipefail` + `ls glob | head` with no match aborts scripts: wrap in `{ … || true; }` (bit the deploy runner and the e2e helper).
- git `safe.directory` must list both `/opt/appetito/repo` and `/opt/appetito/repo/.git` (upload-pack checks the latter).
- Browsers send `Origin: null` on form POSTs when `Referrer-Policy: no-referrer`: confirm pages use `same-origin`.
- Tracker UI helper `h()` renders `0`: use `!!x.length && …` in conditional children.
- The e2e copies only the PC's Claude **access token** (no refresh token) into the box: check `jq .claudeAiOauth.expiresAt ~/.claude/.credentials.json`; the harness refuses if < 40 min left. The account is **Pro**: use `--model sonnet` (default in the harness) and don't burn the quota.
- `claude --settings '{"attribution":{"commit":"","pr":""},"includeCoAuthoredBy":false}'` removes co-author trailers (done in the adapter).
- opencode 1.18.32 resolves paths against `$PWD`: the adapter sets `PWD` and `--dir`. Denied tools are simply not offered to the model.
- A local tracker for UI/video tests: see `dev/video` (Playwright script in the old scratchpad was ad hoc; `record.js` is the real one). Screens at phone width looked right after the fixes (drawer, worker page).

## Next steps, in order

1. Fix the brain firewall check; rerun `tests/e2e/run --scenario first-issue --repeat 3` until 3 consecutive PASS; close 005/012 partially.
2. ~~Vaultwarden~~ closed by the agent (gate 7 core). Left in dev issue 014: the other four starter issues in the sandbox.
3. Ubuntu 24.04 amd64, then arm64 for both distros (`--arch arm64`, slow: emulated).
4. ~~Brain e2e~~ done: `--scenario brain` PASS, dev issue 009 closed.
5. ~~Ollama contract~~ green via `tests/contract/ollama.sh`. Left for 003: `tests/contract/agent-run.sh claude-code` once (quota).
6. Video: real Vaultwarden run recorded with `dev/video/record.js` against a box with fixed ports (add `-p 127.0.0.1:18080:8080 -p 127.0.0.1:18081:8081 -p 127.0.0.1:18222:8222` and set `TRACKER_ORIGINS=http://127.0.0.1:18080`, `TRACKER_CONFIRM_ORIGINS=http://127.0.0.1:18081` in the box, restart the tracker), copy footage+marks to `dev/video/public/`, `npm run render`; judge drafts yourself, show the owner only the final candidate; make `docs/media/demo.gif`.
7. Screenshots for the post from the sandbox; owner approves video + post (HITL, push notification).
8. Dev issue 019 (history rewrite) right before the owner says go; then `make check` must be zero hits.

Push notifications: only when blocked, when a gate item completes, and at the end (Italian, short). Never push to GitHub, never touch the Edge or `~/Desktop/Projects/personal/home-server` (read-only source; a shallow clone from `edge:home-server` is fine in the scratchpad).
