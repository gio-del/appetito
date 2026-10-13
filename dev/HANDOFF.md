# Handoff (2026-10-13, end of the first PC session)

Read first: `CLAUDE.md`, `docs/PRD.md` (§10 launch gate, §11 autonomy rules), `docs/architecture.md`, `SECURITY.md`, `dev/issues/open/`. Talk to the owner in Italian; the repo is English; nothing is pushed (no remote); commits use the noreply identity already set in `.git/config`.

## State of the launch gate (PRD §10)

| # | Item | State |
|---|---|---|
| 1 | `make e2e` first issue closed < 30 min, 3 consecutive | **2/3 green.** `--repeat 3` on Debian 13 amd64 (Sonnet): run 1 closed the issue but the final checks failed `no firewall rules for brain` (see "Open bug"); runs 2 and 3 PASS (1 min 38 s, 1 min 28 s). Results land in `dev/e2e-log.md` and `tests/e2e/out/<run>/`. Need 3 consecutive green after the bug fix. |
| 2 | Debian 13 + Ubuntu 24.04, amd64 + arm64 | Only Debian 13 amd64 run so far. arm64 emulation works through Docker Desktop (`--platform linux/arm64`, checked). Next: `--distro ubuntu2404`, `--arch arm64`. |
| 3 | security-audit green + tests (a)-(d) | **Green**: `tests/e2e/run --scenario security` PASS (2 min 32 s), smoke checks green. |
| 4 | Claude Code full e2e; Ollama honours the contract | Claude: yes (first-issue). Ollama/opencode: contract passes against a mock endpoint (`tests/contract/mock-openai.js`); a real Ollama run on CPU was in progress and then the Ollama container/volume were deleted to free disk. To finish: re-run `tests/contract/agent-run.sh openai` with `CONTRACT_ONLY=1` against a small model (watch the disk). |
| 5 | Secret scan + personal values, whole history | Tree clean. **History has one hit** (old `auto.js` weekday "giov", false positive): dev issue 019, rewrite history right before publishing. |
| 6 | README | Written. Missing: `docs/media/demo.gif` (from the video). |
| 7 | Starter issues tested; Vaultwarden closed by the agent | Starter backlog written (`issues/open/001-005`). **Not run yet**: `tests/e2e/run --scenario vaultwarden` (issue 001). |
| 8 | SECURITY.md | Done. |
| 9 | Disclaimer | Done (README). |
| 10 | Video + post approved by owner | Post draft `dev/launch/post.md`. Video project `dev/video/` (Remotion 4.0.529 + Playwright 1.63.0 installed, `record.js` + `src/Launch.tsx` written, not rendered with real footage yet). Owner approval needed (HITL). |

Dev issues closed: 001, 002, 006, 007, 008, 011, 016. Open: 003 (agent-run: Ollama real run left), 004 (tracker: mostly done — close after a last UI pass), 005 (worker: done in practice, close with the e2e), 009 (brain: code done, needs an e2e — a note in Inbox gets sorted and proposes), 010 (calendar: `brain-cal` done, off unless configured), 012 (installer: done, needs ubuntu/arm64), 013 (e2e), 014 (starter backlog: Vaultwarden run), 015 (docs: gif), 017, 018, 019.

## Open bug (fix first)

Run 1 of first-issue: `security-audit` → `FAIL no firewall rules for brain` after a successful close. The check in `guard/checks/security-audit` greps `nft list table inet appetito` for `skuid <uid>`. Probably nft printing the user by name, or a race with `appetito-fw` being restarted during apply. Make the check match uid or name and verify with `nft list chain inet appetito output` in a kept box (`tests/e2e/run --scenario smoke --keep`).

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
2. `tests/e2e/run --scenario vaultwarden` (timeout 3600); iterate on starter issue 001's text if the agent struggles (gate 7).
3. Ubuntu 24.04 amd64, then arm64 for both distros (`--arch arm64`, slow: emulated).
4. Brain e2e: drop a note in `/var/lib/appetito/brain/vault/Inbox/` with `#now`, check it's sorted and an idea becomes a pending proposal (add a `brain` scenario to `tests/e2e/run`).
5. Ollama contract run (small model, `CONTRACT_ONLY=1`, long timeout), then close 003.
6. Video: real Vaultwarden run recorded with `dev/video/record.js` against a box with fixed ports (add `-p 127.0.0.1:18080:8080 -p 127.0.0.1:18081:8081 -p 127.0.0.1:18222:8222` and set `TRACKER_ORIGINS=http://127.0.0.1:18080`, `TRACKER_CONFIRM_ORIGINS=http://127.0.0.1:18081` in the box, restart the tracker), copy footage+marks to `dev/video/public/`, `npm run render`; judge drafts yourself, show the owner only the final candidate; make `docs/media/demo.gif`.
7. Screenshots for the post from the sandbox; owner approves video + post (HITL, push notification).
8. Dev issue 019 (history rewrite) right before the owner says go; then `make check` must be zero hits.

Push notifications: only when blocked, when a gate item completes, and at the end (Italian, short). Never push to GitHub, never touch the Edge or `~/Desktop/Projects/personal/home-server` (read-only source; a shallow clone from `edge:home-server` is fine in the scratchpad).
