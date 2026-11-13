#!/bin/sh
# Test of mail-fetch (issue 015) with a fake curl standing in for the Apps Script: off without a URL, list -> notes -> ack,
# test mail, status.json, the script copy deleted after the first good answer, errors shown without failing the job
# for an hour. Offline. From the repo root: device/edge/tests/mail-fetch.sh
set -eu
R=$(cd "$(dirname "$0")/../../.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home/.secrets" "$T/setup" "$T/status" "$T/drop" "$T/bin"
printf 'abc123\n' > "$T/home/.secrets/mail-secret"
echo 'script' > "$T/status/edge-mail.gs"
# Fake curl: records the request (stdin) and answers from $T/mode.
cat > "$T/bin/curl" <<'EOF'
#!/bin/sh
o=; while [ $# -gt 0 ]; do case $1 in -o) o=$2; shift 2 ;; *) u=$1; shift ;; esac; done
req=$(cat); printf '%s\n' "$req" >> "$FAKE_DIR/requests"
a=$(printf '%s' "$req" | jq -r .action)
case $(cat "$FAKE_DIR/mode") in
down) echo "curl: (6) Could not resolve host" >&2; exit 6 ;;
html) echo '<html>Accedi</html>' > "$o"; exit 0 ;;
auth) echo '{"ok":false,"error":"auth"}' > "$o"; exit 0 ;;
esac
raw=$(printf 'From: G <gio@gmail.com>\r\nTo: gio+edge@gmail.com\r\nSubject: Nota\r\n\r\nComprare il latte\r\n' | base64 -w0)
case $a in
list) printf '{"ok":true,"account":"gio@gmail.com","alias":"gio+edge@gmail.com","messages":[{"id":"abcd0001","self":true,"date":"2026-11-04T09:00:00Z","raw":"%s"},{"id":"abcd0002","self":false,"date":"2026-11-04T09:00:00Z","raw":"%s"}]}' "$raw" "$(printf 'From: x@evil.example\r\n\r\nx' | base64 -w0)" > "$o" ;;
ack) printf '{"ok":true,"acked":%s}' "$(printf '%s' "$req" | jq '.ids | length')" > "$o" ;;
send) echo '{"ok":true,"sent":"gio@gmail.com"}' > "$o" ;;
esac
if [ -e "$FAKE_DIR/vmode" ]; then jq -c '.v = 2' "$o" > "$o.v" && mv "$o.v" "$o"; fi
EOF
chmod +x "$T/bin/curl"
run() {
	env HS_ENV_FILE=/dev/null HS_TEST_UID=mailer HS_MAIL_HOME="$T/home" HS_MAIL_SETUP="$T/setup" HS_MAIL_STATUS="$T/status" HS_MAIL_DROP="$T/drop" \
		HS_MAIL_LIB="$R/device/edge/debian/mail/mail-import.js" HS_MAIL_CALL="$R/device/edge/debian/mail/mail-call.sh" HS_MAIL_CURL="$T/bin/curl" FAKE_DIR="$T" sh "$R/device/edge/debian/mail-fetch"
}
fail() { echo "FAIL: $1" >&2; exit 1; }
echo ok > "$T/mode"

# Off without a URL: no call at all.
run; [ ! -e "$T/requests" ] || fail "called without URL"
echo '{"url":"https://evil.example/x","at":1}' > "$T/setup/url.json"
run 2> /dev/null && fail "accepted a foreign URL"
now=$(date +%s)
printf '{"url":"https://script.google.com/macros/s/AKfycbx123456789012345678901/exec","at":%s}\n' "$now" > "$T/setup/url.json"

# Script unreachable: shown in status, the job does not fail within the first hour.
echo down > "$T/mode"
run 2> "$T/err" || fail "failed at once on a network error"
jq -e '.ok == false and (.error | startswith("Google non raggiungibile"))' "$T/status/status.json" > /dev/null || fail "network error not in status"
[ -e "$T/status/edge-mail.gs" ] || fail "script copy deleted before a good answer"
echo html > "$T/mode"; run 2> /dev/null
jq -e '.error | test("Chiunque")' "$T/status/status.json" > /dev/null || fail "html answer: no hint about access"
echo auth > "$T/mode"; run 2> /dev/null
jq -e '.error | test("segreto")' "$T/status/status.json" > /dev/null || fail "auth error not explained"
# ...but it fails after an hour without a good answer.
printf '{"url":"https://script.google.com/macros/s/AKfycbx123456789012345678901/exec","at":%s}\n' $((now - 4000)) > "$T/setup/url.json"
run 2> /dev/null && fail "no failure after an hour of errors"

# Good answer: one note (the self mail), the forged one rejected, both acked, secret never on a command line.
echo ok > "$T/mode"; : > "$T/requests"
printf '{"at":%s}\n' "$now" > "$T/setup/test.json"
out=$(run)
echo "$out" | grep -q 'scartata: x@evil.example (mittente non in lista)' || fail "rejected sender not logged: $out"
echo "$out" | grep -q 'nuove note: 1' || fail "note not counted: $out"
ls "$T/drop" | grep -q '^Mail 2026-11-04 .* Nota 0001\.md$' || fail "note not written: $(ls "$T/drop")"
grep -q 'Comprare il latte' "$T/drop/"*.md || fail "note body"
[ "$(jq -sc '[.[].action]' "$T/requests")" = '["send","list","ack"]' ] || fail "calls: $(jq -sc '[.[].action]' "$T/requests")"
jq -se '.[2].ids == ["abcd0001","abcd0002"] and all(.secret == "abc123")' "$T/requests" > /dev/null || fail "ack ids or secret"
jq -e '.ok and .lastOk and .accepted == 1 and .rejectedCount == 1 and .alias == "gio+edge@gmail.com" and .test.ok and (.rejected[0].from == "x@evil.example") and .error == null' \
	"$T/status/status.json" > /dev/null || fail "status: $(cat "$T/status/status.json")"
[ ! -e "$T/status/edge-mail.gs" ] || fail "script copy kept after a good answer"
# The same test request is not sent twice; counters add up; the test result stays.
: > "$T/requests"; run > /dev/null
[ "$(jq -sc '[.[].action]' "$T/requests")" = '["list","ack"]' ] || fail "test mail sent twice"
jq -e '.accepted == 2 and .test.ok' "$T/status/status.json" > /dev/null || fail "counters"
jq -e '.scriptVersion == 1' "$T/status/status.json" > /dev/null || fail "no v in the answer is version 1"
# A newer copy (issue 415, mail-setup put it back): kept while the published script answers with an older v, gone at v 2.
printf "var SECRET = 'abc';\nvar VERSION = 2;  // x\n" > "$T/status/edge-mail.gs"
run > /dev/null
[ -e "$T/status/edge-mail.gs" ] || fail "newer copy deleted by an older script"
echo v2 > "$T/vmode"; run > /dev/null
[ ! -e "$T/status/edge-mail.gs" ] || fail "copy kept once the script is up to date"
jq -e '.scriptVersion == 2' "$T/status/status.json" > /dev/null || fail "scriptVersion not recorded"
echo down > "$T/mode"; run 2> /dev/null; echo ok > "$T/mode"
jq -e '.scriptVersion == 2' "$T/status/status.json" > /dev/null || fail "scriptVersion lost on an error"
rm "$T/vmode"
echo "mail-fetch: ok"
