#!/bin/sh
# Test of hs-monitor's app-upgrade issues (issue 098) with fake update-apps answers.
# Run from the repo root: device/edge/tests/hs-monitor-updates.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
D=86400000 NOW=2000000000000
iso() { node -e "console.log(new Date($1).toISOString())"; }
old=$(iso $((NOW - 8*D))) fresh=$(iso $((NOW - 2*D)))
VW=sha256:$(printf '%064d' 7)
# Run 1: homepage minor released 8 days ago (issue), sumisura 2 days ago (none yet), homepage major
# 8 days ago (issue, blocked on the owner), bw-cli calendar version over a new year (not a major),
# a Vaultwarden digest without date (first seen now: none), an injected version string (dropped).
# Run 2, 7 days later: sumisura and the Vaultwarden digest are old enough now.
cat > "$t/fake.json" <<J
{ "runs": [
  { "now": $NOW, "pending": { "apps": [
    { "app": "homepage", "cur": "v2.5.0", "new": "v2.5.1", "published": "$old", "how": "bump" },
    { "app": "sumisura", "cur": "v0.4.0-3-gabc", "new": "v0.5.0", "published": "$fresh", "how": "bump" },
    { "app": "uptime-kuma", "cur": "2.0.1", "new": "3.0.0", "published": "$old", "how": "bump" },
    { "app": "bw-cli", "cur": "2026.9.1", "new": "2027.1.0", "published": "$old", "how": "bump" },
    { "app": "node", "cur": "v22.23.3", "new": "v22.23.4", "published": "$old", "how": "bump" },
    { "app": "vaultwarden", "cur": "1.37.4", "new": "1.37.4", "published": "", "how": "bump", "ref": "$VW" },
    { "app": "homepage", "cur": "v2.5.0", "new": "v9\`rm -rf /\`", "published": "$old", "how": "bump" } ] } },
  { "now": $((NOW + 7*D)), "pending": { "apps": [
    { "app": "sumisura", "cur": "v0.4.0-3-gabc", "new": "v0.5.0", "published": "$fresh", "how": "bump" },
    { "app": "vaultwarden", "cur": "1.37.4", "new": "1.37.4", "published": "", "how": "bump", "ref": "$VW" } ] } } ] }
J
device/edge/debian/hs-monitor --updates-test "$t/fake.json" > "$t/out"
cat > "$t/want" <<'W'
[{"fp":"update-homepage-v2.5.1","blocked":"","apply":true},{"fp":"update-uptime-kuma-3.0.0","blocked":"user (aggiornamento major)","apply":false},{"fp":"update-bw-cli-2027.1.0","blocked":"","apply":true},{"fp":"update-node-v22.23.4","blocked":"","apply":true}]
[{"fp":"update-sumisura-v0.5.0","blocked":"","apply":false},{"fp":"update-vaultwarden-1.37.4-000000000000","blocked":"","apply":true}]
W
if diff -u "$t/want" "$t/out"; then echo "ok: hs-monitor updates"; else echo "FAIL: hs-monitor updates"; exit 1; fi
# Changelog path in the update issue (issue 141): release CHANGELOG.md for AdGuard Home, tag archive for the pinned apps.
cl() { device/edge/debian/hs-monitor --changelog-test "$@"; }
ok=1
cl adguardhome v0.107.79 v0.107.80 | grep -q '/usr/local/share/hs-docs/adguardhome/0.107.80/CHANGELOG.md' || ok=
cl homepage v2.5.0 v2.5.1 | grep -q 'gethomepage/homepage/archive/refs/tags/v2.5.1.tar.gz.*hs-docs/homepage/2.5.0/.*hs-docs/homepage/2.5.1/' || ok=
cl vaultwarden 1.37.4 1.38.0 | grep -q '\.env\.template.*dani-garcia/vaultwarden/archive/refs/tags/1.38.0.tar.gz' || ok=
cl vaultwarden 1.37.4 1.37.4 | grep -q 'stessa versione' || ok=
[ -z "$(cl sumisura v0.4.0 v0.5.0)" ] || ok=
if [ "$ok" ]; then echo "ok: hs-monitor update changelog"; else echo "FAIL: hs-monitor update changelog"; exit 1; fi
