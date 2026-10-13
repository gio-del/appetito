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
