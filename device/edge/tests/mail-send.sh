#!/bin/sh
# Test of mail-send (issue 410) with a fake curl standing in for the Apps Script: off without a URL (exit 0), foreign URL
# refused, limits, body from argument and stdin, send request with the secret on stdin only, readable errors. Offline.
# From the repo root: device/edge/tests/mail-send.sh
set -eu
R=$(cd "$(dirname "$0")/../../.." && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home/.secrets" "$T/setup" "$T/bin"
printf 'abc123\n' > "$T/home/.secrets/mail-secret"
cat > "$T/bin/curl" <<'EOF2'
#!/bin/sh
o=; while [ $# -gt 0 ]; do case $1 in -o) o=$2; shift 2 ;; *) shift ;; esac; done
cat >> "$FAKE_DIR/requests"; echo >> "$FAKE_DIR/requests"
case $(cat "$FAKE_DIR/mode") in
down) echo "curl: (6) Could not resolve host" >&2; exit 6 ;;
auth) echo '{"ok":false,"error":"auth"}' > "$o" ;;
*) echo '{"ok":true,"sent":"gio@gmail.com"}' > "$o" ;;
esac
EOF2
chmod +x "$T/bin/curl"
send() {
	env HS_ENV_FILE=/dev/null HS_TEST_UID=mailer HS_MAIL_HOME="$T/home" HS_MAIL_SETUP="$T/setup" \
		HS_MAIL_CALL="$R/device/edge/debian/mail/mail-call.sh" HS_MAIL_CURL="$T/bin/curl" FAKE_DIR="$T" sh "$R/device/edge/debian/mail-send" "$@"
}
fail() { echo "FAIL: $1" >&2; exit 1; }
echo ok > "$T/mode"; : > "$T/requests"

# Off without a URL: exit 0, a message, no call.
out=$(send "Oggetto" "Corpo") || fail "failed while off"
echo "$out" | grep -q 'non attivo' || fail "no message while off: $out"
[ ! -s "$T/requests" ] || fail "called without URL"
echo '{"url":"https://evil.example/x","at":1}' > "$T/setup/url.json"
send "Oggetto" "Corpo" 2> /dev/null && fail "accepted a foreign URL"
echo '{"url":"https://script.google.com/macros/s/AKfycbx123456789012345678901/exec","at":1}' > "$T/setup/url.json"

# Limits and usage.
send 2> /dev/null && fail "no arguments accepted"
send "" "x" 2> /dev/null && fail "empty subject accepted"
send "$(head -c 201 /dev/zero | tr '\0' a)" "x" 2> /dev/null && fail "long subject accepted"
head -c 100001 /dev/zero | tr '\0' a | send "S" 2> /dev/null && fail "long body accepted"
[ ! -s "$T/requests" ] || fail "called with bad input"

# Body from argument and from stdin.
send "Prova àè" "Ciao dal server" | grep -q 'mandata a gio@gmail.com' || fail "argument body"
printf 'riga 1\nriga 2\n' | send "Da stdin" | grep -q mandata || fail "stdin body"
jq -se 'length == 2 and all(.secret == "abc123" and .action == "send") and .[0].subject == "Prova àè" and .[0].body == "Ciao dal server" and .[1].body == "riga 1\nriga 2"' \
	"$T/requests" > /dev/null || fail "requests: $(cat "$T/requests")"

# --html (issue 415): the HTML goes as its own field next to the text; big bodies (over one exec argument's 128 KB) pass.
: > "$T/requests"
printf '<p>Ciao <b>àè</b></p>' > "$T/h.html"
send --html "$T/h.html" "Con HTML" "testo" | grep -q mandata || fail "html send"
jq -se 'length == 1 and .[0].html == "<p>Ciao <b>àè</b></p>" and .[0].body == "testo" and .[0].subject == "Con HTML"' "$T/requests" > /dev/null || fail "html request: $(cat "$T/requests")"
: > "$T/requests"
head -c 290000 /dev/zero | tr '\0' a > "$T/big.html"
head -c 99000 /dev/zero | tr '\0' b | send --html "$T/big.html" "Grande" > /dev/null || fail "big html and body"
jq -se '.[0].html | length == 290000' "$T/requests" > /dev/null || fail "big html not sent whole"
: > "$T/requests"
send --html "$T/none.html" "S" "x" 2> /dev/null && fail "missing html file accepted"
: > "$T/empty.html"; send --html "$T/empty.html" "S" "x" 2> /dev/null && fail "empty html accepted"
head -c 300001 /dev/zero | tr '\0' a > "$T/big.html"; send --html "$T/big.html" "S" "x" 2> /dev/null && fail "long html accepted"
send --html 2> /dev/null && fail "--html without file accepted"
[ ! -s "$T/requests" ] || fail "called with bad html input"

# Errors are readable and give a non-zero exit.
echo down > "$T/mode"; send "S" "C" 2> "$T/err" && fail "ok on network error"
grep -q 'Google non raggiungibile' "$T/err" || fail "network error text: $(cat "$T/err")"
echo auth > "$T/mode"; send "S" "C" 2> "$T/err" && fail "ok on auth error"
grep -q 'segreto' "$T/err" || fail "auth error text: $(cat "$T/err")"
echo "mail-send: ok"
