#!/bin/bash
# in-box.sh: the e2e's hands inside the box (run as root in the container). It acts like the owner
# would from a phone: sets the password through the setup link, signs in on the confirm origin, and
# uses the tracker's API. Usage: in-box.sh COMMAND [ARGS]
set -euo pipefail
M=http://127.0.0.1:8080 C=http://127.0.0.1:8081 J=/root/e2e-cookies PW=${E2E_PASSWORD:-e2e-password-not-secret}
api() { # api METHOD PATH [JSON]
	curl -sS -b "$J" -c "$J" -H "Origin: $M" -H 'content-type: application/json' -X "$1" "$M$2" ${3:+-d "$3"}
}
case $1 in
setup)
	t=$(grep -o 'setup?token=[A-Za-z0-9_-]*' /root/install.log | tail -1 | cut -d= -f2)
	code=$(curl -sS -o /dev/null -w '%{http_code}' -c "$J" -H "Origin: $C" --data-urlencode "token=$t" --data-urlencode "password=$PW" --data-urlencode "password2=$PW" "$C/setup")
	[ "$code" = 303 ] || { echo "setup failed: $code" >&2; exit 1; }
	api GET /api/issues | jq -e '.issues' >/dev/null && echo "signed in" ;;
login)
	curl -sS -o /dev/null -c "$J" -H "Origin: $C" --data-urlencode "password=$PW" "$C/login" ;;
create) # create TITLE DESC_FILE [COLUMN] → prints the id
	jq -n --arg t "$2" --rawfile d "$3" --arg c "${4:-todo}" '{title:$t, desc:$d, column:$c}' > /tmp/body.json
	api POST /api/issues "$(cat /tmp/body.json)" | jq -r .id ;;
move) # move ID COLUMN
	v=$(api GET "/api/issues/$2" | jq -r .version)
	api PATCH "/api/issues/$2" "{\"version\":\"$v\",\"column\":\"$3\"}" | jq -r '"#\(.id) → \(.column)"' ;;
start) # start [ID]
	if [ -n "${2:-}" ]; then b="{\"issue\":\"$2\"}"; else b='{}'; fi
	api POST /api/auto/run "$b" | jq -c . ;;
status)
	api GET /api/auto | jq -c '.status | {code, current: (.current.id // null), queue: .queueTotal, gates: {quotaUntil: .gates.quotaUntil, budget: .gates.budget}}' ;;
wait-closed) # wait-closed ID TIMEOUT_S: closed on main and its branch merged
	id=$2 end=$(( $(date +%s) + $3 )) last=""
	while [ "$(date +%s)" -lt "$end" ]; do
		if ls /opt/appetito/repo/issues/done/"$id"-*.md >/dev/null 2>&1; then echo "closed"; exit 0; fi
		s=$(api GET /api/auto 2>/dev/null | jq -r '.status.code // "?"' 2>/dev/null || echo '?')
		d=$(cat /var/lib/appetito/deploy/branches/agent_"$id"-*.json 2>/dev/null | jq -r .state 2>/dev/null | tail -1 || true)
		now="worker=$s deploy=${d:-none}"
		[ "$now" = "$last" ] || { echo "$(date +%T) $now"; last=$now; }
		case $d in rolled-back|rejected|conflict) echo "deploy: $d"; ;; esac
		sleep 10
	done
	echo "timeout"; exit 1 ;;
*) echo "unknown command $1" >&2; exit 2 ;;
esac
