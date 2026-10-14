# Clean the history before publishing

Opened: 2026-10-13
Closed: 2026-10-14
Status: done
Priority: high
Labels: gate-5, launch

`scripts/check-personal` must report zero hits over the whole history (gate 5). Known: an early version of `core/tracker/public/auto.js` had the Italian weekday abbreviations, one of which collides with a personal value (false positive, fixed in the tree since), and the first commits of `dev/HANDOFF.md` quoted it. Nothing has been pushed, so the local history can be rewritten.

- [x] Right before the first push: rewrite the history so no commit contains a hit (`git filter-repo`/`filter-branch` in a scratch clone), then `make check` = zero hits, gitleaks clean
- [x] Re-run the e2e on the rewritten HEAD

## Progress

- 2026-10-14: backup `../appetito-history-backup-20261014.bundle` (git bundle --all, verified). `git filter-branch --tree-filter` replaced only the quoted weekday abbreviation (single or double quotes) with "giov" in 72 commits; the final tree is identical; refs/original and the reflog dropped, gc. `make check`: check-personal 0 hits over the whole history, gitleaks no leaks, lint ok. Commit hashes changed (dev/e2e-log.md keeps the old ones). Closed.
