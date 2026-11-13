#!/bin/sh
# Test of questions-recheck (issue 354): each Check: kind with a true and a false outcome, invalid checks, nothing
# closed or edited, found.json rewritten each round (a resolved-elsewhere issue drops out), lint of the grammar.
# Fake apt-cache and curl. From the repo root: device/edge/tests/questions-recheck.sh
set -eu
S=$(pwd)/device/edge/debian/questions-recheck
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir "$t/open" "$t/qs" "$t/st"
cat > "$t/apt" <<'X'
#!/bin/sh
case $2 in
caddy) printf '%s\n' "$2:" "  Installed: 2.6.2" "  Candidate: ${FAKE_CADDY:-2.6.2-12}" ;;
*) printf '%s\n' "$2:" "  Candidate: (none)" ;;
esac
X
cat > "$t/curl" <<'X'
#!/bin/sh
case "$*" in
*releases/latest*) echo '{"tag_name":"v1.4.0"}' ;;
*-w*) case "$*" in *up.example*) printf 200 ;; *) printf 503 ;; esac ;;
esac
X
chmod +x "$t/apt" "$t/curl"
mk() { printf '# T\n\nOpened: 2026-10-31\nBlocked on: user (x)\nStatus: todo\nCheck: %s\n\n\nbody\n' "$2" > "$t/open/$1-x.md"; }
mk 001 "deb-version caddy >= 2.11.4-1"
mk 002 "release foo/bar >= 1.3.0"
mk 003 "release foo/bar >= 1.5.0"
mk 004 "url-status https://up.example/x"
mk 005 "url-status https://down.example/x"
mk 006 "file-exists $t/open/001-x.md"
mk 007 "file-exists /nonexistent/zzz"
mk 008 "deb-version caddy; rm -rf / >= 1"
mk 009 "frobnicate x"
printf '# T\n\nOpened: 2026-10-31\nStatus: todo\n\nbody\n' > "$t/open/010-x.md"
cp -r "$t/open" "$t/before"
export QS_DIR=$t/qs QS_STATE=$t/st QR_APT_POLICY=$t/apt QR_CURL=$t/curl
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
val() { jq -r --arg i "$1" '.[$i].ok' "$t/qs/found.json"; }
sh "$S" "$t/open"
check "deb-version below" "$(val 001)" false
check "release above" "$(val 002)" true
check "release below" "$(val 003)" false
check "url up" "$(val 004)" true
check "url down" "$(val 005)" false
check "file exists" "$(val 006)" true
check "file missing" "$(val 007)" false
check "injection rejected" "$(val 008)" null
check "unknown kind rejected" "$(val 009)" null
check "issue without Check absent" "$(jq 'has("010")' "$t/qs/found.json")" false
check "issues untouched" "$(diff -r "$t/open" "$t/before" >/dev/null && echo same)" same
FAKE_CADDY=2.11.4-1 sh "$S" "$t/open"
check "deb-version reached" "$(val 001)" true
check "evidence text" "$(jq -r '.["001"].evidence' "$t/qs/found.json")" "apt offre caddy 2.11.4-1 (>= 2.11.4-1)"
rm "$t/open/001-x.md"
sh "$S" "$t/open"
check "closed issue drops out" "$(jq 'has("001")' "$t/qs/found.json")" false
# backlog issue whose Check passes goes back to todo, once, with a dated note (issue 297)
printf '# T\n\nOpened: 2026-10-31\nBlocked on: user (avviso senza versione corretta)\nRisk-accepted: 2027-02-01\nStatus: backlog\nCheck: release foo/bar >= 1.3.0\n\nbody\n' > "$t/open/011-x.md"
printf '# T\n\nOpened: 2026-10-31\nBlocked on: user (x)\nStatus: backlog\nCheck: release foo/bar >= 1.5.0\n\nbody\n' > "$t/open/012-x.md"
sh "$S" "$t/open"; sh "$S" "$t/open"
check "backlog + Check ok -> todo" "$(sed -n 's/^Status: //p' "$t/open/011-x.md")" todo
check "backlog + Check ok -> unblocked" "$(sed -n 's/^Blocked on: //p' "$t/open/011-x.md")" "-"
check "note written once" "$(grep -c '(recheck)$' "$t/open/011-x.md")" 1
check "backlog + Check false untouched" "$(sed -n 's/^Status: //p' "$t/open/012-x.md")" backlog
check "advisory text no longer says close" "$(grep -c 'Poi chiudi la issue' device/edge/debian/hs-monitor || true)" 0
# grammar shared with issues-lint
v=$(node -e 'const {checkValid:c}=require(process.argv[1]);console.log([c("deb-version caddy >= 2.1"),c("url-status https://a.b/c"),c("file-exists /x/y"),c("release a/b >= v1.2"),c("rm -rf /"),c("deb-version a; b >= 1"),c("file-exists rel/p")].join())' "$(pwd)/device/edge/tracker/issues.js")
check "checkValid grammar" "$v" "true,true,true,true,false,false,false"
exit $fail
