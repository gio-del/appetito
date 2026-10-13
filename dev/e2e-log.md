# e2e runs

One line per `make e2e` run (`tests/e2e/run`).

| when | commit | distro | arch | scenario | backend | time | result |
|---|---|---|---|---|---|---|---|
| 2026-10-13 19:27 | 2e05001 | debian13 | amd64 | smoke | claude-code (sonnet) | 1 min | fail: install failed |
| 2026-10-13 19:28 | 76c761e | debian13 | amd64 | smoke | claude-code (sonnet) | 1 min | fail: install failed |
| 2026-10-13 19:31 | 910bead | debian13 | amd64 | smoke | claude-code (sonnet) | 2 min | fail: see tests/e2e/out/20261013-192902-debian13-amd64-smoke |
