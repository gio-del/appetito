#!/bin/sh
# Installer for a clean Debian 13 or Ubuntu 24.04 (issue 569, epic 567). Run it as root from the folder of this copy:
#   sudo ./install.sh [--user NAME] [--no-tailscale] [--dry-run]
# What it does, in order: checks the system, installs the packages, creates the user (NAME, asked if not given),
# starts runit as a system service (systemd unit hs-runsvdir), writes device/edge/home-server.env from its template,
# puts the copy in the user's home as ~/home-server, runs the first deploy as that user and enables the base services.
# Secure by default: HS_SECURITY_ENABLED=true, optional services stay off, everything listens on 127.0.0.1.
# Safe to run again: what exists is kept (the env file is never overwritten, the user and the unit are reused).
# --dry-run prints every command instead of running it. For tests: HS_INSTALL_ROOT = prefix of the system files read.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=${HS_INSTALL_ROOT:-}
USER_NAME=""; TS=1; DRY=""
die() { echo "install.sh: $*" >&2; exit 1; }
say() { echo "== $*"; }
x() { echo "+ $*"; [ -n "$DRY" ] || "$@"; }
while [ $# -gt 0 ]; do
	case $1 in
	--user) [ $# -ge 2 ] || die "--user wants a name"; USER_NAME=$2; shift 2 ;;
	--no-tailscale) TS=""; shift ;;
	--dry-run) DRY=1; shift ;;
	-h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
	*) die "unknown option: $1 (see --help)" ;;
	esac
done

# 1. System: root, Debian 13 / Ubuntu 24.04, not the phone.
[ -n "$DRY" ] || [ "$(id -u)" = 0 ] || die "run as root (sudo ./install.sh)"
OSR=$ROOT/etc/os-release
[ -r "$OSR" ] || die "no $OSR: not a Debian or Ubuntu system"
os_id=$(sed -n 's/^ID=//p' "$OSR" | tr -d '"' | head -1)
os_ver=$(sed -n 's/^VERSION_ID=//p' "$OSR" | tr -d '"' | head -1)
case "$os_id $os_ver" in
"debian 13"|"ubuntu 24.04") ;;
*) die "supported: Debian 13 and Ubuntu 24.04 (this is: $os_id $os_ver)" ;;
esac
if [ -x "$HERE/device/edge/debian/hs-on-android" ] && "$HERE/device/edge/debian/hs-on-android"; then
	die "this is Android: the phone has its own installer (device/edge/install.sh)"
fi
[ -f "$HERE/device/edge/deploy" ] || die "device/edge/deploy not found next to this script"
say "system: $os_id $os_ver"

# 2. The user. Asked only when it cannot be known: --user, the existing env file, the sudo caller, else a question.
ENVF=$HERE/device/edge/home-server.env
if [ -z "$USER_NAME" ] && [ -s "$ENVF" ]; then USER_NAME=$(sed -n 's/^HS_USER=//p' "$ENVF" | tr -d "\"' " | tail -1); fi
if [ -z "$USER_NAME" ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then USER_NAME=$SUDO_USER; fi
if [ -z "$USER_NAME" ] && [ -t 0 ]; then printf 'Linux user that will own the server (e.g. hs): '; read -r USER_NAME; fi
[ -n "$USER_NAME" ] || die "which user? pass --user NAME"
case $USER_NAME in root) die "the user cannot be root" ;; esac
printf '%s' "$USER_NAME" | grep -Eq '^[a-z][a-z0-9_-]{0,30}$' || die "invalid user name: $USER_NAME"
if [ -n "$DRY" ]; then UHOME=$ROOT/home/$USER_NAME; else UHOME=$(getent passwd "$USER_NAME" | cut -d: -f6 || true); UHOME=${UHOME:-/home/$USER_NAME}; fi
say "user: $USER_NAME ($UHOME)"

# 3. Packages. The services of the packages are disabled afterwards: runit supervises them.
say "packages"
PKGS="runit sudo git jq curl ca-certificates gnupg cron openssh-server util-linux perl nodejs shellcheck caddy syncthing acl openssl"
x env DEBIAN_FRONTEND=noninteractive apt-get update -q
# shellcheck disable=SC2086
x env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends $PKGS
# Without a running systemd (a container, the clean-install proof) units are enabled/disabled but not started/stopped.
NOW=--now; SD=1
if [ -z "$DRY" ] && [ ! -d /run/systemd/system ]; then NOW=''; SD=''; say "systemd is not running: units are set up but not started"; fi
for u in caddy syncthing; do
	# Not every distribution ships a system unit for each (Ubuntu has syncthing@.service only): disable what exists.
	if [ -n "$DRY" ] || systemctl list-unit-files "$u.service" 2>/dev/null | grep -q "^$u\.service"; then
		# shellcheck disable=SC2086
		x systemctl disable $NOW "$u.service"
	else
		echo "no system unit $u.service, nothing to disable"
	fi
done
if [ -n "$TS" ]; then
	say "tailscale (official apt repository)"
	if [ -n "$DRY" ] || ! command -v tailscaled >/dev/null 2>&1; then
		codename=$(sed -n 's/^VERSION_CODENAME=//p' "$OSR" | head -1)
		x install -d -m 755 /usr/share/keyrings
		x curl -fsSL -o /usr/share/keyrings/tailscale-archive-keyring.gpg "https://pkgs.tailscale.com/stable/$os_id/$codename.noarmor.gpg"
		x curl -fsSL -o /etc/apt/sources.list.d/tailscale.list "https://pkgs.tailscale.com/stable/$os_id/$codename.tailscale-keyring.list"
		x env DEBIAN_FRONTEND=noninteractive apt-get update -q
		x env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends tailscale
	fi
	# runit runs tailscaled (sv/tailscaled), not the package's own unit.
	# shellcheck disable=SC2086
	x systemctl disable $NOW tailscaled.service
fi

# 4. The user, with the sudo the deploy needs (checked with visudo before it is installed).
if [ -n "$DRY" ] || ! id "$USER_NAME" >/dev/null 2>&1; then
	say "creating user $USER_NAME"
	x useradd -m -s /bin/bash "$USER_NAME"
	# Password "*": key login only, and sshd accepts the account (a "!" locked one is refused).
	x usermod -p '*' "$USER_NAME"
fi
SUDOERS=$HERE/.sudoers.new.$$
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$USER_NAME" > "$SUDOERS"
if [ -n "$DRY" ] || visudo -cf "$SUDOERS" >/dev/null; then x install -m 440 -o root -g root "$SUDOERS" "/etc/sudoers.d/hs-$USER_NAME"; else rm -f "$SUDOERS"; die "sudoers rule refused by visudo"; fi
rm -f "$SUDOERS"

# 5. runit as a system service.
say "runit (hs-runsvdir.service)"
UNIT=$HERE/.hs-runsvdir.service.$$
cat > "$UNIT" <<'EOF'
[Unit]
Description=runit supervision of the home server services (/etc/hs-service)
After=network-online.target

[Service]
ExecStart=/usr/bin/runsvdir -P /etc/hs-service
Restart=always
KillMode=process

[Install]
WantedBy=multi-user.target
EOF
x install -d -m 755 /etc/hs-service /etc/hs-sv
x install -m 644 "$UNIT" /etc/systemd/system/hs-runsvdir.service
rm -f "$UNIT"
[ -z "$SD" ] || x systemctl daemon-reload
# shellcheck disable=SC2086
x systemctl enable $NOW hs-runsvdir.service

# 6. The env file (never overwritten) and the copy in the user's home.
say "device/edge/home-server.env"
if [ ! -s "$ENVF" ]; then
	cp "$HERE/device/edge/home-server.env.example" "$ENVF"
	lan=$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1 || true)
	sed -i "s/^HS_USER=.*/HS_USER=$USER_NAME/" "$ENVF"
	[ -z "$lan" ] || sed -i "s/^HS_LAN_IP=.*/HS_LAN_IP=$lan/" "$ENVF"
	grep -q '^HS_SECURITY_ENABLED=' "$ENVF" || echo 'HS_SECURITY_ENABLED=true' >> "$ENVF"
	echo "written $ENVF (HS_SECURITY_ENABLED=true). HS_TS_* and HS_*_TS_IP stay at the template values until you set the tailnet ones."
else
	echo "$ENVF exists, kept"
fi
TARGET=$UHOME/home-server
if [ "$HERE" != "$TARGET" ]; then
	say "copy in $TARGET"
	if [ -e "$TARGET/device/edge/deploy" ]; then echo "$TARGET already holds a copy, kept (update it with git)"
	else x install -d -m 755 "$TARGET"; x cp -a "$HERE/." "$TARGET/"; fi
fi
x chown -R "$USER_NAME:$(id -gn "$USER_NAME" 2>/dev/null || echo "$USER_NAME")" "$TARGET"
[ -d "$TARGET/.git" ] || x runuser -u "$USER_NAME" -- git -C "$TARGET" init -q
# /etc/home-server.env must exist first: the deploy applies locally when it finds it.
x install -m 644 "$TARGET/device/edge/home-server.env" /etc/home-server.env

# 6b. The Caddyfile wants a certificate for HS_TS_HOST, which tailscale only gives after 'tailscale up' (and never with
# --no-tailscale). Until a real one is put there (tls-renew), a self-signed placeholder lets Caddy start; sites stay on 127.0.0.1.
TLSDIR=/var/lib/caddy/tls
if [ -n "$DRY" ]; then HOST_TLS=server.example.ts.net; else HOST_TLS=$(sed -n 's/^HS_TS_HOST=//p' "$ENVF" | tr -d "\"' " | tail -1); fi
if [ -n "$HOST_TLS" ] && { [ -n "$DRY" ] || [ ! -s "$TLSDIR/$HOST_TLS.crt" ]; }; then
	say "placeholder certificate for $HOST_TLS"
	x install -d -m 700 -o caddy -g caddy "$TLSDIR"
	x openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=$HOST_TLS" -addext "subjectAltName=DNS:$HOST_TLS" -keyout "$TLSDIR/$HOST_TLS.key" -out "$TLSDIR/$HOST_TLS.crt"
	x chown caddy:caddy "$TLSDIR/$HOST_TLS.key" "$TLSDIR/$HOST_TLS.crt"
	x chmod 600 "$TLSDIR/$HOST_TLS.key"
fi

# 6c. Two things the deploy expects that a stock system lacks: node where the scripts look for it, and sshd's
# privilege-separation directory (sshd -t, run by the deploy, refuses without it; sshd creates it itself when it starts).
if [ ! -e /usr/local/bin/node ] && [ -x /usr/bin/node ]; then x ln -s /usr/bin/node /usr/local/bin/node; fi
x install -d -m 755 /run/sshd

# 7. First deploy as the user, then the base services (the optional ones stay off).
say "first deploy"
# --skip-tests only here: the copy passed its checks before it was published, and its tests need the tracker and the
# helpers this very deploy installs (the first deploy cannot satisfy them). Later deploys run them all.
x runuser -u "$USER_NAME" -- sh -c "cd '$TARGET' && HS_DEPLOY_WORKER=1 device/edge/deploy --skip-tests"
say "syncthing: sync port on 127.0.0.1 only"
# A fresh Syncthing listens on every interface (:22000). Only a config made here is changed, never an existing one.
ST=/home/$USER_NAME/.local/state/syncthing
if [ ! -f "$ST/config.xml" ]; then
	x runuser -u "$USER_NAME" -- env HOME="/home/$USER_NAME" syncthing generate --home="$ST"
	x runuser -u "$USER_NAME" -- perl -pi -e 's{<listenAddress>default</listenAddress>}{<listenAddress>tcp://127.0.0.1:22000</listenAddress>}' "$ST/config.xml"
fi
say "base services"
BASE="tracker caddy syncthing"
[ -z "$TS" ] || BASE="$BASE tailscaled"
for s in $BASE; do
	[ -e "$ROOT/etc/hs-service/$s" ] || x ln -s "/etc/hs-sv/$s" "/etc/hs-service/$s"
done
say "done"
echo "Next: log in as $USER_NAME and read $TARGET/README.md."
[ -z "$TS" ] || echo "Tailscale: run 'sudo tailscale up' once, then put the names and IPs in $TARGET/device/edge/home-server.env."
