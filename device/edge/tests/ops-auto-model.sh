#!/bin/sh
# Test of ops-auto's model/effort choice (issue 117): by label (monitor/lint/update = maintenance),
# escalation to HS_AUTO_MODEL and default effort from the second attempt. Uses the real hs-setting
# on a temp settings file. From the repo root: device/edge/tests/ops-auto-model.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bin"
cp "$R/device/edge/debian/hs-setting" "$t/bin/hs-setting"
export PATH=$t/bin:$PATH HS_SETTINGS_SCHEMA=$R/device/edge/tracker/settings.schema.json \
	HS_SETTINGS_FILE=$t/settings.env HS_SETTINGS_ENV=$t/none
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
issue() { printf '# x\n\nStatus: todo\nLabels: %s\n\nLabels: lint\n' "$1" > "$t/i.md"; }
m() { issue "$1"; sh "$R/device/edge/debian/ops-auto-model" "$t/i.md" "$2"; }
check "feature, defaults" "$(m ops,tracker 1)" "default default"
check "lint, defaults" "$(m lint 1)" "sonnet low manutenzione"
check "update among labels" "$(m "ops, update" 1)" "sonnet low manutenzione"
check "monitor keeps effort" "$(m monitor,backup 1)" "sonnet default manutenzione"
check "lint 2nd attempt escalates" "$(m lint 2)" "default default modello alzato (tentativo 2)"
check "label as substring is not one" "$(m linting 1)" "default default"
printf 'HS_AUTO_MODEL=opus\nHS_AUTO_MODEL_MAINT=haiku\nHS_AUTO_EFFORT_MAINT=medium\n' > "$t/settings.env"
check "feature uses HS_AUTO_MODEL" "$(m ops 1)" "opus default"
check "maintenance settings" "$(m update 1)" "haiku medium manutenzione"
check "escalates to HS_AUTO_MODEL" "$(m monitor 3)" "opus default modello alzato (tentativo 3)"
printf 'HS_AUTO_EFFORT_MAINT=xtreme\n' > "$t/settings.env"
check "invalid effort falls back to default low" "$(m lint 1)" "sonnet low manutenzione"
check "no Labels line" "$(printf '# x\n' > "$t/i.md"; sh "$R/device/edge/debian/ops-auto-model" "$t/i.md" 1)" "default default"
exit $fail
