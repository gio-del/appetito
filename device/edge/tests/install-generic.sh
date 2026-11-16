#!/bin/sh
# Decisions of the generic installer (issue 569): appetito/root/install.sh in --dry-run on a fake tree, and
# hs-on-android on fake Android/Debian trees. No network, no root, nothing installed.
# From the repo root: device/edge/tests/install-generic.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
fail() { echo "FAIL: install-generic: $*"; exit 1; }
repo=$(pwd)
OA=$repo/device/edge/debian/hs-on-android
INST=$repo/appetito/root/install.sh; [ -f "$INST" ] || INST=$repo/install.sh  # in the public copy it is at the root

# hs-on-android: Android kernel / build.prop / /data/adb say yes, a plain Debian says no, the override wins without a tree.
mkdir -p "$t/a/proc" "$t/d/proc"
echo "Linux version 6.1.141-android14-11 (build)" > "$t/a/proc/version"
echo "Linux version 6.12.0-amd64 (debian)" > "$t/d/proc/version"
HS_ANDROID_ROOT=$t/a "$OA" || fail "android kernel not recognised"
HS_ANDROID_ROOT=$t/d "$OA" && fail "debian taken for android"
mkdir -p "$t/d/data/adb"; HS_ANDROID_ROOT=$t/d "$OA" || fail "/data/adb not recognised"
rm -rf "$t/d/data"; mkdir -p "$t/d/system"; : > "$t/d/system/build.prop"
HS_ANDROID_ROOT=$t/d "$OA" || fail "build.prop not recognised"
HS_ON_ANDROID=0 "$OA" && fail "override 0 ignored"
HS_ON_ANDROID=1 "$OA" || fail "override 1 ignored"

# A fake copy: the installer, the deploy marker, the env template and a hs-on-android that says "not Android".
mk() { # DIR OSID VERSION
	mkdir -p "$1/device/edge/debian" "$1/etc" "$1/home"
	cp "$INST" "$1/install.sh"; chmod +x "$1/install.sh"
	: > "$1/device/edge/deploy"
	cp "$repo/device/edge/home-server.env.example" "$1/device/edge/"
	printf '#!/bin/sh\nexit 1\n' > "$1/device/edge/debian/hs-on-android"; chmod +x "$1/device/edge/debian/hs-on-android"
	printf 'ID=%s\nVERSION_ID="%s"\nVERSION_CODENAME=x\n' "$2" "$3" > "$1/etc/os-release"
}
run() { d=$1; shift; (cd "$d" && HS_INSTALL_ROOT=$d ./install.sh --dry-run "$@" 2>&1); }

mk "$t/c1" debian 13
out=$(run "$t/c1" --user hsuser) || fail "debian 13: $out"
echo "$out" | grep -q 'useradd -m -s /bin/bash hsuser' || fail "user not created"
echo "$out" | grep -q 'hsuser ALL=(ALL) NOPASSWD' || true
echo "$out" | grep -q 'enable --now hs-runsvdir.service' || fail "runit not started as a service"
echo "$out" | grep -q 'HS_DEPLOY_WORKER=1 device/edge/deploy' || fail "no first deploy"
echo "$out" | grep -q 'ln -s /etc/hs-sv/tailscaled' || fail "tailscaled not enabled by default"
echo "$out" | grep -q 'pkgs.tailscale.com' || fail "tailscale repository missing"
for s in tracker caddy syncthing; do echo "$out" | grep -q "ln -s /etc/hs-sv/$s " || fail "base service $s not enabled"; done
# nothing optional on by default
echo "$out" | grep -Eq 'ln -s /etc/hs-sv/(ntfy|radicale|brain|ops|deploy-worker)' && fail "optional service enabled"
# env: user, security on, kept on a second run
e=$t/c1/device/edge/home-server.env
grep -qx 'HS_USER=hsuser' "$e" || fail "HS_USER not written"
grep -qx 'HS_SECURITY_ENABLED=true' "$e" || fail "security not enabled"
echo 'HS_LAN_IP=10.9.9.9' >> "$e"
out=$(run "$t/c1" --user other) || fail "second run: $out"
echo "$out" | grep -q 'kept' || fail "env file not kept"
grep -qx 'HS_USER=hsuser' "$e" || fail "env file overwritten by the second run"
grep -qx 'HS_LAN_IP=10.9.9.9' "$e" || fail "env file lost a value"
# listen addresses: the installer opens nothing, and writes no secret
grep -Eq '0\.0\.0\.0|password|secret' "$t/c1/install.sh" && fail "installer mentions open listening or secrets"

# --no-tailscale
mk "$t/c2" ubuntu 24.04
out=$(run "$t/c2" --user hs2 --no-tailscale) || fail "ubuntu 24.04: $out"
echo "$out" | grep -q 'tailscale' && fail "--no-tailscale still touches tailscale"
echo "$out" | grep -q 'ln -s /etc/hs-sv/tracker' || fail "ubuntu: tracker missing"
# without Tailscale Caddy stays on loopback (issue 596); with Tailscale, or --listen-lan, the value is not written
grep -qx 'HS_CADDY_BIND=127.0.0.1' "$t/c2/device/edge/home-server.env" || fail "--no-tailscale: Caddy not on loopback"
grep -q '^HS_CADDY_BIND=' "$t/c1/device/edge/home-server.env" && fail "with Tailscale HS_CADDY_BIND written"
mk "$t/c2b" debian 13
run "$t/c2b" --user hs2 --no-tailscale --listen-lan > /dev/null || fail "--listen-lan refused"
grep -q '^HS_CADDY_BIND=' "$t/c2b/device/edge/home-server.env" && fail "--listen-lan still binds loopback"
# the three LAN-facing Caddy sites follow HS_CADDY_BIND and default to every IPv4 interface (the owner's server is unchanged)
[ "$(grep -c 'bind {\$HS_CADDY_BIND:0.0.0.0}' "$repo/device/edge/debian/Caddyfile")" = 3 ] || fail "Caddyfile: three sites must use HS_CADDY_BIND"

# refusals
mk "$t/c3" debian 12
out=$(run "$t/c3" --user hs3) && fail "debian 12 accepted"; echo "$out" | grep -q 'supported' || fail "no message for debian 12: $out"
mk "$t/c4" fedora 40
run "$t/c4" --user hs4 > /dev/null && fail "fedora accepted"
mk "$t/c5" debian 13
out=$(run "$t/c5" --user root) && fail "root accepted"
out=$(run "$t/c5" --user 'Bad Name') && fail "invalid name accepted"
printf '#!/bin/sh\nexit 0\n' > "$t/c5/device/edge/debian/hs-on-android"
out=$(run "$t/c5" --user hs5) && fail "android accepted"; echo "$out" | grep -q 'Android' || fail "no Android message: $out"
out=$(run "$t/c5" --bogus) && fail "unknown option accepted"
# without a user and no terminal: asks to pass one, not guess
mk "$t/c6" debian 13
out=$(run "$t/c6" < /dev/null) && fail "no user accepted"; echo "$out" | grep -q -- '--user' || fail "no hint for --user: $out"
echo "ok: install-generic"
