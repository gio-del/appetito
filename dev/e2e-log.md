# e2e runs

One line per `make e2e` run (`tests/e2e/run`).

| when | commit | distro | arch | scenario | backend | time | result |
|---|---|---|---|---|---|---|---|
| 2026-10-13 19:27 | 2e05001 | debian13 | amd64 | smoke | claude-code (sonnet) | 1 min | fail: install failed |
| 2026-10-13 19:28 | 76c761e | debian13 | amd64 | smoke | claude-code (sonnet) | 1 min | fail: install failed |
| 2026-10-13 19:31 | 910bead | debian13 | amd64 | smoke | claude-code (sonnet) | 2 min | fail: see tests/e2e/out/20261013-192902-debian13-amd64-smoke |
| 2026-10-13 19:36 | 15a186d | debian13 | amd64 | smoke | claude-code (sonnet) | 2 min | pass |
| 2026-10-13 19:39 | 12e822c | debian13 | amd64 | security | fake (sonnet) | 2 min | fail: see tests/e2e/out/20261013-193704-debian13-amd64-security |
| 2026-10-13 22:09 | 427f1fa | debian13 | amd64 | security | fake (sonnet) | 1 min | fail: install failed |
| 2026-10-13 22:13 | 6188228 | debian13 | amd64 | security | fake (sonnet) | 3 min | fail: see tests/e2e/out/20261013-220959-debian13-amd64-security |
| 2026-10-13 22:17 | 22f105e | debian13 | amd64 | security | fake (sonnet) | 3 min | pass |
| 2026-10-13 22:20 | 45ae2fa | debian13 | amd64 | first-issue | claude-code (sonnet) | 2 min | fail: see tests/e2e/out/20261013-221819-debian13-amd64-first-issue |
| 2026-10-13 22:25 | 96258e1 | debian13 | amd64 | first-issue | claude-code (sonnet) | 2 min | fail: see tests/e2e/out/20261013-222308-debian13-amd64-first-issue |
| 2026-10-13 22:28 | 96258e1 | debian13 | amd64 | first-issue | claude-code (sonnet) | 2 min | pass |
| 2026-10-13 22:31 | f0d4ceb | debian13 | amd64 | first-issue | claude-code (sonnet) | 2 min | pass |
| 2026-10-13 22:37 | 454939d | debian13 | amd64 | first-issue | claude-code (sonnet) | 2 min | pass |
| 2026-10-13 22:39 | 454939d | debian13 | amd64 | first-issue | claude-code (sonnet) | 2 min | pass |
| 2026-10-13 22:42 | 454939d | debian13 | amd64 | first-issue | claude-code (sonnet) | 2 min | pass |
| 2026-10-13 22:45 | 6d7eacf | debian13 | amd64 | brain | claude-code (sonnet) | 2 min | pass |
| 2026-10-13 22:51 | 5fc2f10 | debian13 | amd64 | vaultwarden | claude-code (sonnet) | 6 min | fail: deploy conflict (agent branched before the tracker's move to To do was committed; fixed in the worker), then quota gate 69% > 50%; stopped by hand |
| 2026-10-13 22:55 | 2c83795 | ubuntu2404 | amd64 | security | fake (sonnet) | 3 min | pass |
| 2026-10-13 22:56 | 2c83795 | debian13 | arm64 | security | fake (sonnet) | 0 min | fail: image build failed (no arm64 binfmt in Docker Desktop) |
| 2026-10-14 06:40 | d7124d2 | debian13 | amd64 | vaultwarden | claude-code (sonnet) | 29 min | fail: no conflict this time (worker fix ok); Vaultwarden deployed but rolled back by a flaky tracker unit test (5 s server start); the agent fixed it on #006, held as waiting-guard (correct); stopped by hand |
| 2026-10-14 09:28 | 4f31298 | debian13 | arm64 | security | fake (sonnet) | 44 min | fail: emulation limits, not appetito: qemu-user has no netfilter Netlink (`nft`: Protocol not supported) so appetito-fw fails; install 14 min, tracker not up in 60 s; journald empty |
| 2026-10-14 10:02 | 3df1c8c | debian13 | amd64 | vaultwarden | claude-code (sonnet) | 31 min | pass: agent run 2.5 min, merged, handed with 2 (HITL) steps; owner part played by hand (throwaway age key, no Tailscale), then the agent closed #001 in 18 s; checks green. Harness now plays the owner itself (tests/e2e/owner/001.sh) |
| 2026-10-14 11:20 | 95b9f8b | debian13 | amd64 | video | claude-code (sonnet) | 6 min | pass |
| 2026-10-14 11:31 | a8cb503 | debian13 | amd64 | video | claude-code (sonnet) | 7 min | pass |
| 2026-10-14 11:41 | 2085e17 | debian13 | amd64 | video | claude-code (sonnet) | 6 min | pass |
| 2026-10-14 12:09 | d9e8c78 | debian13 | amd64 | video | claude-code (sonnet) | 24 min | fail: see tests/e2e/out/20261014-114406-debian13-amd64-video |
| 2026-10-14 12:36 | a8ef2c3 | debian13 | amd64 | video | claude-code (sonnet) | 15 min | pass |
| 2026-10-14 12:47 | cc30f8e | debian13 | amd64 | video | claude-code (sonnet) | 7 min | pass |
