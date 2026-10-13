# Clean the history before publishing

Opened: 2026-10-13
Blocked on: -
Status: todo
Priority: high
Labels: gate-5, launch

`scripts/check-personal` must report zero hits over the whole history (gate 5). Known: an early version of `core/tracker/public/auto.js` had the Italian weekday abbreviations, one of which collides with a personal value (false positive, fixed in the tree since), and the first commits of `dev/HANDOFF.md` quoted it. Nothing has been pushed, so the local history can be rewritten.

- [ ] Right before the first push: rewrite the history so no commit contains a hit (`git filter-repo`/`filter-branch` in a scratch clone), then `make check` = zero hits, gitleaks clean
- [ ] Re-run the e2e on the rewritten HEAD
