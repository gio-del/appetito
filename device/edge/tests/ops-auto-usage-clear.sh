#!/bin/sh
# Issue 573: a run that ends well with rate_limit_events but none for seven_day drops the saved weekly value
# (the quota is under the CLI's warning threshold); a seven_day event is saved. Temp HOME/repo, stub claude.
# From the repo root: device/edge/tests/ops-auto-usage-clear.sh
set -eu
R=$(pwd)
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
round() { # $1 = stream line of the stub, prints the content of the usage file after a round
	t=$(mktemp -d); H=$t/home
	mkdir -p "$H/bin" "$H/.local/bin" "$H/home-server/issues/open" "$H/home-server/issues/done" "$H/.local/state/ops-auto"
	cp "$R/device/edge/debian/ai-run" "$R/device/edge/debian/ops-auto" "$R/device/edge/debian/ops-auto-request" "$H/bin/"
	printf '#!/bin/sh\n' > "$H/bin/ops-auto-card"
	printf '#!/bin/sh\ncase $1 in HS_AUTO_QUOTA_MAX) echo 50 ;; HS_AUTO_PAUSE) echo 0 ;; HS_AUTO_MAX_PER_RUN) echo 1 ;; HS_AI_BACKEND) echo headless ;; *) echo default ;; esac\n' > "$H/.local/bin/hs-setting"
	printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/hs-runlog"
	printf '#!/bin/sh\nexit 0\n' > "$H/.local/bin/issues-context"
	printf '#!/bin/sh\n' > "$H/.local/bin/hs-run"
	printf '#!/bin/sh\ncat <<'"'"'EOJ'"'"'\n%s\n{"type":"result","subtype":"success","is_error":false,"num_turns":1,"total_cost_usd":0.1,"result":"x"}\nEOJ\n' "$1" > "$H/.local/bin/claude"
	chmod +x "$H/bin/"* "$H/.local/bin/"*
	echo "40 4102444800" > "$H/.local/state/ops-auto/usage"
	printf '# Prova\n\nOpened: 2026-10-27\nBlocked on: -\nStatus: todo\n' > "$H/home-server/issues/open/019-prova.md"
	(cd "$H/home-server"; git init -q -b main && git config user.name t && git config user.email t@t && git add -A && git commit -qm init)
	(cd "$H/home-server"; HS_QUEUE_PROJECTS_JSON= HOME="$H" HS_AUTO_QUIET=-2000000000 HS_AUTO_REQUEST="$t/none.json" HS_AUTO_DETAIL="$t/detail.json" HS_ISSUES_JS="$R/device/edge/tracker/issues.js" "$H/bin/ops-auto" > /dev/null 2>&1 || true)
	cat "$H/.local/state/ops-auto/usage" 2>/dev/null || echo none
	rm -rf "$t"
}
check "only five_hour: value removed" "$(round '{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"five_hour":{"utilization":0.1,"resetsAt":4102444800}}}}')" none
check "seven_day 80%: saved" "$(round '{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"seven_day":{"utilization":0.8,"resetsAt":4102444800}}}}')" "80 4102444800"
check "no rate_limit_event: kept" "$(round '{"type":"system"}')" "40 4102444800"
exit $fail
