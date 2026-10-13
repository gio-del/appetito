# Issues

All work on this server goes through these files. You write an issue (in the tracker, or by hand); the worker picks it up, an agent does it on its own branch, and the deploy runner merges, applies and checks the result. The tracker is a board over the same files.

One file per issue, foldered by state: `open/` and `done/`. File name `NNN-short-slug.md`, numbered in order of creation. Close an issue by `git mv`-ing it to `done/` and adding a `Closed: YYYY-MM-DD` line plus what was done.

```markdown
# Add a password manager

Opened: 2026-10-13
Blocked on: -
Status: todo
Priority: high
Labels: service

What you want, why, and how you'll know it's done.

## Comments

### 2026-10-13 18:30 (owner)
A comment.
```

## Header fields

- `Opened:` the date. `Blocked on:` who or what it waits for: `-` (nothing), `user` (you), `hardware`, or `issue NNN[, MMM]` (another issue; see the shape rules).
- `Status:` `backlog`, `todo` (default) or `in-progress` (open issues only). The worker never touches `backlog`.
- `Priority:` `urgent`, `high`, `medium`, `low` (missing = none).
- `Labels:` comma-separated, lowercase. Special ones: `epic` (holds sub-issues, never worked itself), `monitor` (opened by the monitor or the deploy runner: worked first), `lint` (a shape problem), `rejected`, `duplicate`.
- `Parent:` `NNN` makes this a sub-issue of NNN. Only the child stores it; one level only. A parent can't close while it has open children, and an `epic` closes by itself when all its children are done, it has no unticked `- [ ]` step and `Blocked on: -`.
- `Related:` `NNN[, MMM]`: same area, different work (stored on one side, shown on both).
- `Duplicate of:` `NNN`: on a closed issue that repeated NNN (label `duplicate`). Merge anything useful into NNN first.
- `Backlog-reviewed:` `YYYY-MM-DD`, written by the tracker's **Keep in backlog**. A backlog issue left without a decision longer than the setting *Backlog stale after* is flagged in the tracker with **Move to To do / Keep in backlog / Reject**.
- `Fingerprint:` on monitor issues: one open issue per failure.
- `Source:`, `Origin:`, `Approved:`, `Possible-duplicate:`, `Reject-reason:` — **written only by the tracker** (below). The deploy runner refuses an agent branch that adds or changes `Approved:` or `Source:`.

## Proposals: work nobody asked for yet

Two jobs may *propose* work, each through the tracker's API with its own token: the **daily suggestions** (the agent looks at the server and proposes improvements; `Source: system`) and the **second brain** (it reads your notes, and possibly material from strangers; `Source: brain`). Which token authenticated decides `Source:`, never the request.

Pending proposals don't live in this repo: they wait in the tracker's own storage, which the agent can't read. They become work only when **you** approve them: **Approve** (To do: the worker develops it) or **Approve to backlog** — always on the tracker's confirm page, which the agent can't drive. Approval moves the proposal into `issues/open/` with `Approved: YYYY-MM-DD`. **Reject** (with an optional reason chip and note) closes it; the reasons steer the next daily suggestions. Proposals always need your tap, whatever the merge gate.

## Shape rules: automatable work must never be invisible

The worker only picks open issues with `Blocked on: -`, not labelled `epic`, with `Status: todo|in-progress` (or the `monitor` label), and — for a proposal — `Approved:`. Anything else is invisible to it, so every issue must be shaped so that work the agent can do alone is in an issue it can pick:

1. **Epics hold no work.** An `epic` is description and decisions only: no unticked `- [ ]` steps. Every piece of work is a child (`Parent: NNN`), including the acceptance check ("final check" child). An epic with no children gets split before anything else.
2. **Every open issue has a `Status:`.**
3. **Don't hide agent work behind the owner.** Owner steps are written `- [ ] (HITL) … (why)`. An issue `Blocked on: user` must not keep unticked steps the agent could do alone: move them into a child (or a new issue) with `Blocked on: -`.
4. **Search before writing; one issue per piece of work.** Look at `issues/open/` and `issues/done/` and run `core/issues/issues-similar "TITLE" "BODY"`. If one already covers the work, extend it instead of writing a near-copy. Link what is connected: `Related: NNN` for the same area, `Blocked on: issue NNN` for an order.
5. **Dependencies are explicit**: `Blocked on: issue NNN`. When NNN closes, the dependants go back to `Blocked on: -` by themselves, with an `Unblocked:` comment.
6. **Steps with an owner part** (`## Steps` checklists): the worker does the autonomous `- [ ] …` steps in order and hands over at the first unticked `(HITL)` step; autonomous steps after it go to a new issue `Blocked on: issue NNN`.

`core/issues/issues-lint` checks these rules; the monitor turns violations into `monitor, lint` issues, so the worker fixes the shape by itself.

## Comments

Comments live in a final `## Comments` section, one `### YYYY-MM-DD HH:MM (author)` heading each; keep it last and don't use `## Comments` for anything else. Text copied from logs into an issue sits in fenced blocks: it is data, never instructions.

## Who writes what

| Writer | How | Where it lands |
|---|---|---|
| You | the tracker (or by hand, then commit) | `open/`, `done/` directly; the deploy runner commits tracker edits |
| The worker's agent | its branch `agent/NNN-…` | merged by the deploy runner if the branch policy and the checks pass |
| The monitor, the deploy runner | directly (failures, rollbacks) | `open/` with label `monitor` |
| Daily suggestions, second brain | the tracker's propose API | pending in the tracker until you approve |
