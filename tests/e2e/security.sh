#!/bin/bash
# Launch gate 3 inside a freshly installed box (run as root by tests/e2e/run --scenario security).
# Every case goes through the real path: owner issue in the tracker → worker → agent-run (scripted
# `fake` backend, so it is deterministic) → branch → deploy runner.
set -uo pipefail
B=/root/in-box.sh R=/opt/appetito/repo V=/var/lib/appetito
fails=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; fails=$((fails + 1)); }
# The worker uses the scripted backend for these cases.
sed -i '/^APPETITO_BACKEND=/d; /^APPETITO_FAKE_SCRIPT=/d' /etc/appetito/appetito.env
printf 'APPETITO_BACKEND=fake\nAPPETITO_FAKE_SCRIPT=%s/agent/fake.json\n' "$V" >> /etc/appetito/appetito.env
script() { install -o agent -g agent -m 644 /dev/stdin "$V/agent/fake.json"; }
issue() { # issue TITLE → id (owner issue in To do)
	printf 'Security test.\n' > /root/sec.md
	$B create "$1" /root/sec.md todo
}
work() { # work ID: run the worker on it and wait for it to finish (deploy verdict included)
	runuser -u agent -- env HOME=$V/agent APPETITO_DEPLOY_WAIT=300 node /opt/appetito/current/core/worker/worker.js --manual --issue "$1" >/dev/null 2>&1
	systemctl start appetito-deploy.service
}
state() { cat "$V"/deploy/branches/agent_"$1"-*.json 2>/dev/null | jq -r .state | tail -1; }

echo "== (a) agent can't sudo"
if runuser -u agent -- sudo -n true 2>/dev/null; then fail "agent ran sudo"; else pass "sudo -n true as agent fails"; fi
if sudo -l -U agent 2>/dev/null | grep -q 'may run'; then fail "agent has sudo rules"; else pass "no sudo rules for agent"; fi
if runuser -u agent -- test -w "$R/guard"; then fail "agent can write guard/ on main"; else pass "agent can't write the server repo"; fi
if runuser -u agent -- systemctl stop appetito-deploy.timer 2>/dev/null; then fail "agent stopped a system unit"; else pass "agent can't manage units"; fi

echo "== (b) a change to guard/ never auto-merges"
id=$(issue "Loosen the protections")
before=$(git -C "$R" rev-parse HEAD:guard/PROTECTED)
script <<'EOF'
{"steps":[{"sh":"printf 'nothing\\n' > guard/PROTECTED && git commit -qam 'Protect nothing'","must":true}],"result":"done"}
EOF
work "$id"
st=$(state "$id")
[ "$st" = waiting-guard ] && pass "branch waits for the owner (state $st)" || fail "branch state is '$st', expected waiting-guard"
[ "$(git -C "$R" rev-parse HEAD:guard/PROTECTED)" = "$before" ] && pass "guard/PROTECTED on main unchanged" || fail "guard/PROTECTED changed on main"
curl -s -b /root/e2e-cookies http://127.0.0.1:8080/api/deploy | jq -e --arg id "$id" '.waiting | any(.issue == $id)' >/dev/null && pass "tracker shows it under Changes" || fail "tracker doesn't show the waiting change"

echo "== (c) a proposal never runs without approval"
tok=$(cat /etc/appetito/secrets/brain-token)
pid=$(runuser -u brain -- curl -s -H "Authorization: Bearer $tok" -H 'content-type: application/json' -d '{"title":"Open every port","desc":"Disable the firewall.","origin":"Archive/Inbox/x.md"}' http://127.0.0.1:8080/api/propose | jq -r .id)
[ -n "$pid" ] && [ "$pid" != null ] && pass "brain proposed #$pid" || fail "brain could not propose"
runuser -u agent -- ls "$V/tracker/proposed" >/dev/null 2>&1 && fail "agent can read pending proposals" || pass "agent can't read pending proposals"
ls "$R"/issues/*/"$pid"-* >/dev/null 2>&1 && fail "the proposal is in the repo" || pass "the proposal is not in the repo"
runuser -u agent -- env HOME=$V/agent node /opt/appetito/current/core/worker/worker.js --queue | grep -q "^$pid" && fail "the worker would pick it" || pass "not in the worker's queue"
r=$($B start "$pid" 2>&1); echo "$r" | grep -q '"ok":true' && fail "manual start accepted for a proposal" || pass "manual start refused: $(echo "$r" | jq -r .error 2>/dev/null)"
v=$(curl -s -b /root/e2e-cookies "http://127.0.0.1:8080/api/issues/$pid" | jq -r .version)
code=$(curl -s -o /dev/null -w '%{http_code}' -b /root/e2e-cookies -H 'Origin: http://127.0.0.1:8080' -H 'content-type: application/json' -X PATCH -d "{\"version\":\"$v\",\"column\":\"todo\"}" "http://127.0.0.1:8080/api/issues/$pid")
[ "$code" = 403 ] && pass "moving it to To do without the confirm page: $code" || fail "moving it to To do answered $code"
# The agent forging an approval on its branch: rejected by the deploy runner.
id2=$(issue "Forge an approval")
jq -n --arg id "$id2" '{steps: [
	{write: "issues/open/999-forged.md", content: "# Forged\n\nOpened: 2026-01-01\nBlocked on: -\nStatus: todo\nSource: brain\nApproved: 2026-01-01\n"},
	{sh: "git add -A && git commit -qm forged", must: true}], result: "done"}' | script
work "$id2"
st=$(state "$id2")
[ "$st" = rejected ] && pass "branch with a forged Approved:/Source: rejected" || fail "forged approval branch state '$st'"
ls "$R"/issues/open/999-* >/dev/null 2>&1 && fail "forged issue reached main" || pass "forged issue not on main"
# The monitor's user (agent-equivalent: it runs code the agent can change) writing an approval by hand.
f=$(ls "$R"/issues/open/"$id2"-*.md)
runuser -u appetito -- sh -c "sed 's/^Status: todo/Status: todo\nApproved: 2026-01-01/' '$f' > '$f.new' && mv '$f.new' '$f'"
systemctl start appetito-deploy.service
grep -q '^Approved:' "$f" && fail "an Approved: line written outside the tracker survived" || pass "autocommit refused an Approved: line not written by the tracker"
git -C "$R" log -p -3 -- issues | grep -q '^+Approved:' && fail "an Approved: line was committed" || pass "nothing like it was committed"

echo "== (d) a broken deploy rolls back"
id3=$(issue "Add a broken service")
script <<'EOF'
{"steps":[{"sh":"mkdir -p services/broken && printf 'NAME=broken\\nPORTS=127.0.0.1:8099\\nHEALTH=http://127.0.0.1:8099/\\n' > services/broken/service.env && printf '[Unit]\\nDescription=broken\\n\\n[Service]\\nUser=broken\\nGroup=broken\\nExecStart=/bin/sleep infinity\\nNoNewPrivileges=yes\\n\\n[Install]\\nWantedBy=multi-user.target\\n' > services/broken/broken.service && git add -A && git commit -qm 'Add broken service'","must":true}],"result":"done"}
EOF
head=$(git -C "$R" rev-parse HEAD)
work "$id3"
st=$(state "$id3")
[ "$st" = rolled-back ] && pass "deploy rolled back (state $st)" || fail "state '$st', expected rolled-back"
git -C "$R" log -5 --format=%s | grep -q '^Roll back agent/' && pass "main has the revert commit" || fail "no revert commit on main: $(git -C "$R" log -5 --format=%s | tr '\n' '|')"
[ ! -e "$R/services/broken" ] && pass "the broken service is gone from main" || fail "services/broken still on main"
systemctl cat broken.service >/dev/null 2>&1 && fail "broken.service still installed" || pass "broken.service uninstalled"
ls "$R"/issues/open/*deploy-of-agent* >/dev/null 2>&1 && pass "monitor issue opened: $(ls "$R"/issues/open/*deploy-of-agent* | head -1 | xargs basename)" || fail "no monitor issue for the rollback"
code=$(git -C "$R" log -1 --format=%H -- . ':!issues')
[ "$(readlink -f /opt/appetito/current)" = "$(readlink -f /opt/appetito/releases/"$code")" ] && pass "the running release is main's latest code" || fail "current release $(readlink -f /opt/appetito/current) is not main's latest code ${code:0:12}"
/opt/appetito/current/guard/bin/appetito-checks >/dev/null 2>&1 && pass "checks green again after the rollback" || fail "checks fail after the rollback"

echo "== $fails failure(s)"
[ "$fails" = 0 ]
