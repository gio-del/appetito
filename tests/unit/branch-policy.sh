#!/bin/sh
# guard/checks/branch-policy on a scratch repo: PRD launch gate 3(b) and 3(c).
set -eu
BP=$(cd "$(dirname "$0")/../.." && pwd)/guard/checks/branch-policy
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cd "$T" && git init -q -b main r && cd r
git config user.email t@example.invalid && git config user.name t
mkdir -p guard issues/open issues/done issues/proposed core
echo guard/ > guard/PROTECTED
printf 'Opened: 2026-01-01\nBlocked on: -\nStatus: todo\n' > issues/open/001-a.md
printf 'Opened: 2026-01-01\nBlocked on: -\nStatus: backlog\nSource: brain\n' > issues/proposed/002-p.md
printf 'Opened: 2026-01-01\nBlocked on: -\nStatus: todo\nSource: system\nApproved: 2026-01-02\n' > issues/open/003-s.md
echo x > core/x
git add -A && git commit -qm base
base=$(git rev-parse HEAD)
n=0
expect() { # expect VERDICT-PREFIX description, on the current branch vs base
	n=$((n + 1)); got=$("$BP" . "$base" HEAD)
	case $got in "$1"*) echo "ok $n $2" ;; *) echo "FAIL $n $2: got '$got'"; exit 1 ;; esac
	git checkout -q main
}
br() { git checkout -q -b "t$n" main; }
br; echo y >> core/x; git commit -qam c; expect ok "plain core change merges"
br; echo y >> guard/PROTECTED; git commit -qam c; expect protected "guard change waits for the owner (gate 3b)"
br; git mv guard/PROTECTED core/P; git commit -qm c; expect protected "moving a file out of guard/ is still protected"
br; git mv issues/proposed/002-p.md issues/open/002-p.md; git commit -qm c; expect reject "agent can't approve a proposal by moving it (gate 3c)"
br; echo 'Approved: 2026-01-03' >> issues/open/001-a.md; git commit -qam c; expect reject "agent can't add Approved:"
br; printf 'Opened: 2026-01-01\nBlocked on: -\nStatus: todo\nSource: system\n' > issues/open/009-new.md; git add -A; git commit -qm c; expect reject "agent can't create an issue with Source:"
br; git mv issues/open/003-s.md issues/done/003-s.md; printf '\nClosed: 2026-01-04\n%s\n' "$(seq 1 200)" >> issues/done/003-s.md; git commit -qam c; expect ok "closing an approved issue (big edit) is fine"
br; git rm -q issues/open/001-a.md; git commit -qm c; expect reject "deleting an issue is rejected"
br; ln -s /etc/shadow core/link; git add -A; git commit -qm c; expect reject "symlinks are rejected"
br; echo z >> core/x; git commit -qam c; git checkout -q -b side main; echo w > core/w; git add -A; git commit -qm s; git checkout -q "t$n"; git merge -q --no-edit side; expect reject "merge commits are rejected"
br; printf 'Opened: 2026-01-01\nBlocked on: -\nStatus: todo\n' > issues/open/010-follow.md; git add -A; git commit -qm c; expect ok "agent may open a plain follow-up issue"
