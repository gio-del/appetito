#!/bin/sh
# update-apps must find the AdGuard Home tarball in checksums.txt whose names start with "./" (issue 507).
# Run from the repo root: device/edge/tests/update-apps-checksums.sh
set -eu
UA=$PWD/device/edge/debian/update-apps
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
f=AdGuardHome_linux_arm64.tar.gz
printf x > "$t/$f"
h=$(sha256sum "$t/$f" | cut -d' ' -f1)
printf '%s  ./%s\n%s  ./other.zip\n' "$h" "$f" 0000 > "$t/checksums.txt"
grep -qF 'grep -E " (\./)?$f\$" checksums.txt' "$UA" || { echo "FAIL: update-apps-checksums: grep pattern not tolerant of ./"; exit 1; }
(cd "$t" && grep -E " (\./)?$f\$" checksums.txt | sha256sum -c --quiet) || { echo "FAIL: update-apps-checksums: verification"; exit 1; }
echo "ok update-apps-checksums"
