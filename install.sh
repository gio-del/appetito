#!/bin/bash
# appetito installer. Run from your clone, as root, on a dedicated Debian 13 or Ubuntu 24.04 box
# (amd64 or arm64) with systemd:
#
#   sudo ./install.sh                      Tailscale (asks for an auth key), Claude Code backend
#   sudo ./install.sh --no-tailscale       everything stays on 127.0.0.1; exposing it is your job
#
# Options: --backend claude-code|openai, --openai-url URL --openai-model NAME [--openai-key-file F],
#          --tailscale-authkey KEY (or $TS_AUTHKEY), --hostname NAME, --claude-token-file F,
#          --yes (no questions: defaults or the options above).
# Safe to run again: it keeps users, data, secrets and settings, and re-applies the rest.
set -euo pipefail
umask 022
export DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
SRC=$(cd "$(dirname "$0")" && pwd)
OPT=/opt/appetito VAR=/var/lib/appetito ETC=/etc/appetito
OPENCODE_VERSION=1.18.32

TAILSCALE=yes BACKEND="" YES="" OPENAI_URL="" OPENAI_MODEL="" OPENAI_KEY_FILE="" TS_KEY=${TS_AUTHKEY:-} HOSTNAME_TS=appetito CLAUDE_TOKEN_FILE=""
while [ $# -gt 0 ]; do
	case $1 in
	--no-tailscale) TAILSCALE=no ;;
	--backend) BACKEND=$2; shift ;;
	--openai-url) OPENAI_URL=$2; shift ;;
	--openai-model) OPENAI_MODEL=$2; shift ;;
	--openai-key-file) OPENAI_KEY_FILE=$2; shift ;;
	--tailscale-authkey) TS_KEY=$2; shift ;;
	--hostname) HOSTNAME_TS=$2; shift ;;
	--claude-token-file) CLAUDE_TOKEN_FILE=$2; shift ;;
	--yes|-y) YES=1 ;;
	-h|--help) sed -n '2,13p' "$0"; exit 0 ;;
	*) echo "unknown option $1 (see --help)" >&2; exit 2 ;;
	esac
	shift
done

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die() { echo "install: $*" >&2; exit 1; }
ask() { # ask VAR "question" default
	local v; if [ -n "$YES" ] || [ ! -t 0 ]; then printf -v "$1" '%s' "$3"; return; fi
	read -r -p "$2 [$3]: " v; printf -v "$1" '%s' "${v:-$3}"
}

# ------------------------------------------------------------------ checks
[ "$(id -u)" = 0 ] || die "run as root (sudo ./install.sh)"
[ -d /run/systemd/system ] || die "systemd is not running here (appetito needs a systemd host)"
. /etc/os-release
case "$ID:$VERSION_ID" in
debian:13|ubuntu:24.04) ;;
*) echo "warning: tested on Debian 13 and Ubuntu 24.04, this is $PRETTY_NAME" >&2 ;;
esac
ARCH=$(dpkg --print-architecture)
case $ARCH in amd64|arm64) ;; *) echo "warning: tested on amd64 and arm64, this is $ARCH" >&2 ;; esac
[ -f "$SRC/guard/bin/appetito-deploy" ] || die "run install.sh from an appetito clone"

if [ -z "$BACKEND" ]; then
	if [ -f "$ETC/appetito.env" ]; then BACKEND=$(sed -n 's/^APPETITO_BACKEND=//p' "$ETC/appetito.env"); fi
	[ -n "$BACKEND" ] || ask BACKEND "Agent backend (claude-code or openai)" claude-code
fi
case $BACKEND in claude-code|openai) ;; *) die "--backend is claude-code or openai" ;; esac
if [ "$BACKEND" = openai ]; then
	[ -n "$OPENAI_URL" ] || ask OPENAI_URL "OpenAI-compatible endpoint (e.g. http://127.0.0.1:11434/v1 for Ollama)" http://127.0.0.1:11434/v1
	[ -n "$OPENAI_MODEL" ] || ask OPENAI_MODEL "Model name" qwen2.5-coder:7b
fi
if [ "$TAILSCALE" = yes ] && ! tailscale status >/dev/null 2>&1 && [ -z "$TS_KEY" ]; then
	[ -n "$YES" ] && die "Tailscale: pass --tailscale-authkey KEY (or TS_AUTHKEY), or --no-tailscale"
	read -r -s -p "Tailscale auth key (https://login.tailscale.com/admin/settings/keys): " TS_KEY; echo
	[ -n "$TS_KEY" ] || die "no auth key: run again with --no-tailscale to skip Tailscale"
fi

# ------------------------------------------------------------------ packages
say "Packages"
apt-get update -q
apt-get install -y -q --no-install-recommends git jq curl ca-certificates nftables nodejs gettext-base iproute2 \
	procps util-linux passwd tar gzip age syncthing sudo >/dev/null
node -e 'const [a] = process.versions.node.split(".").map(Number); if (a < 18) { console.error("node >= 18 needed, found " + process.version); process.exit(1); }'
if [ "$BACKEND" = openai ] && ! command -v opencode >/dev/null; then
	apt-get install -y -q --no-install-recommends npm >/dev/null
	npm install -g --no-fund --no-audit "opencode-ai@$OPENCODE_VERSION" >/dev/null
fi

# ------------------------------------------------------------------ users and directories
say "Users"
getent group appetito-issues >/dev/null || groupadd --system appetito-issues
getent group appetito-repo >/dev/null || groupadd --system appetito-repo
mkuser() { # mkuser NAME HOME
	id -u "$1" >/dev/null 2>&1 || useradd --system --user-group --home-dir "$2" --shell /usr/sbin/nologin "$1"
	install -d -o "$1" -g "$1" -m 750 "$2"
}
mkuser agent "$VAR/agent"
mkuser brain "$VAR/brain"
mkuser tracker "$VAR/tracker"
mkuser appetito "$VAR/home"
mkuser appetito-egress "$VAR/egress"
usermod -a -G appetito-issues tracker
usermod -a -G appetito-issues appetito
# Who may read the server repo (issues included): not brain, which reads untrusted material.
for u in agent tracker appetito; do usermod -a -G appetito-repo "$u"; done
# The worker's agent and the second brain have no sudo, no privileged group, no login shell.
for u in agent brain tracker appetito; do gpasswd -d "$u" sudo >/dev/null 2>&1 || true; done

say "Directories"
install -d -m 755 "$OPT" "$OPT/releases" "$VAR" "$ETC" "$ETC/services" "$ETC/firewall.d"
install -d -m 711 "$ETC/secrets"
install -d -m 755 "$VAR/deploy" "$VAR/deploy/branches"
install -d -o agent -g agent -m 755 "$VAR/worker"
install -d -o agent -g agent -m 750 "$VAR/agent/home" 2>/dev/null || true
install -d -o tracker -g tracker -m 750 "$VAR/tracker"
install -d -o tracker -g tracker -m 755 "$VAR/requests" "$VAR/worker-request"
install -d -o appetito -g appetito -m 750 "$VAR/monitor"
install -d -o root -g appetito-issues -m 2775 "$VAR/issues-meta"
install -d -o appetito -g appetito -m 1733 "$VAR/events"
[ -f "$VAR/settings.env" ] || install -o tracker -g tracker -m 644 /dev/null "$VAR/settings.env"
# The worker's agent pushes its branches here; the deploy runner fetches them (as agent).
[ -d "$VAR/agent/inbox.git" ] || runuser -u agent -- git init -q --bare "$VAR/agent/inbox.git"
[ -f "$VAR/agent/pushed" ] || install -o agent -g agent -m 644 /dev/null "$VAR/agent/pushed"

# ------------------------------------------------------------------ the server repo
say "Server repo"
if [ ! -d "$OPT/repo/.git" ]; then
	# Your clone belongs to you, not root: trust it for this one copy.
	git -c safe.directory="$SRC" -c safe.directory="$SRC/.git" clone -q --no-hardlinks --upload-pack="git -c safe.directory=$SRC -c safe.directory=$SRC/.git upload-pack" "$SRC" "$OPT/repo"
	up=$(git -c safe.directory="$SRC" -C "$SRC" remote get-url origin 2>/dev/null || true)
	git -C "$OPT/repo" remote remove origin
	[ -z "$up" ] || git -C "$OPT/repo" remote add upstream "$up"
fi
git -C "$OPT/repo" config user.name appetito
git -C "$OPT/repo" config user.email appetito@localhost
git -C "$OPT/repo" config transfer.fsckObjects true
git -C "$OPT/repo" checkout -q main 2>/dev/null || git -C "$OPT/repo" checkout -q -b main
chown -R root:root "$OPT/repo"
chgrp appetito-repo "$OPT/repo" && chmod 750 "$OPT/repo"
for d in open done; do install -d -o root -g appetito-issues -m 2775 "$OPT/repo/issues/$d"; done
chmod -R g+w "$OPT/repo/issues/open" "$OPT/repo/issues/done"
# Readers that aren't root (worker, tracker, monitor) work in a repo they don't own.
for u in agent tracker appetito; do
	h=$(getent passwd "$u" | cut -d: -f6)
	runuser -u "$u" -- env HOME="$h" git config --global --add safe.directory "$OPT/repo" 2>/dev/null || true
done
for d in "$OPT/repo" "$OPT/repo/.git"; do
	git config --system --get-all safe.directory | grep -qx "$d" || git config --system --add safe.directory "$d"
done

# ------------------------------------------------------------------ settings
say "Settings"
if [ "$TAILSCALE" = yes ]; then
	if ! command -v tailscale >/dev/null; then curl -fsSL https://tailscale.com/install.sh | sh; fi
	systemctl enable --now tailscaled
	tailscale status >/dev/null 2>&1 || tailscale up --authkey "$TS_KEY" --hostname "$HOSTNAME_TS"
	DNS=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
	MAIN_ORIGIN="https://$DNS" CONFIRM_ORIGIN="https://$DNS:8443"
else
	MAIN_ORIGIN="http://127.0.0.1:8080" CONFIRM_ORIGIN="http://127.0.0.1:8081"
fi
token() { head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'; }
if [ ! -f "$ETC/appetito.env" ]; then
	cat > "$ETC/appetito.env" <<EOF
# appetito settings (root only). Jobs read this file; the tracker's settings page writes the rest
# to $VAR/settings.env. Change and run: systemctl restart appetito-tracker (or reboot).
APPETITO_BACKEND=$BACKEND
# Per job, e.g. a local model for the second brain: APPETITO_BACKEND_BRAIN_SORT=openai
APPETITO_MERGE_GATE=auto
APPETITO_FIREWALL=on
APPETITO_EGRESS_PORT=3128
APPETITO_TAILSCALE=$TAILSCALE
TRACKER_PORT=8080
TRACKER_CONFIRM_PORT=8081
TRACKER_ORIGINS=$MAIN_ORIGIN
TRACKER_CONFIRM_ORIGINS=$CONFIRM_ORIGIN
TRACKER_AUTHOR=owner
APPETITO_CLAUDE_TOKEN_FILE=$ETC/secrets/claude-token
APPETITO_OPENAI_BASE_URL=$OPENAI_URL
APPETITO_OPENAI_MODEL=$OPENAI_MODEL
APPETITO_OPENAI_API_KEY_FILE=${OPENAI_KEY_FILE:+$ETC/secrets/openai-key}
EOF
fi
chmod 644 "$ETC/appetito.env"
if [ -n "$OPENAI_KEY_FILE" ]; then install -o agent -g agent -m 640 "$OPENAI_KEY_FILE" "$ETC/secrets/openai-key"; fi

# Proposers' tokens: the tracker keeps only their hash.
for who in brain:brain suggest:agent; do
	name=${who%%:*} user=${who##*:}
	if [ ! -s "$ETC/secrets/$name-token" ]; then
		t=$(token)
		printf '%s\n' "$t" | install -o "$user" -g "$user" -m 600 /dev/stdin "$ETC/secrets/$name-token"
		printf '%s' "$t" | sha256sum | cut -d' ' -f1 | install -o tracker -g tracker -m 600 /dev/stdin "$VAR/tracker/$name-token"
	fi
done

# ------------------------------------------------------------------ second brain
say "Second brain"
if [ ! -d "$VAR/brain/vault" ]; then
	cp -r "$OPT/repo/core/brain/vault-template" "$VAR/brain/vault"
	chown -R brain:brain "$VAR/brain/vault"
	runuser -u brain -- env HOME="$VAR/brain" "$OPT/repo/core/brain/vault-autocommit"
fi
install -d -o brain -g brain -m 700 "$VAR/brain/state" "$VAR/brain/.cache" "$VAR/brain/.cache/brain-propose" "$VAR/brain/.cache/brain-cal"
SYNC_IP=127.0.0.1
[ "$TAILSCALE" = yes ] && SYNC_IP=$(tailscale ip -4 | head -1)
runuser -u brain -- env HOME="$VAR/brain" "$OPT/repo/core/brain/syncthing-setup" "$SYNC_IP"

# ------------------------------------------------------------------ agent backend
say "Agent backend: $BACKEND"
if [ "$BACKEND" = claude-code ]; then
	for u in agent brain; do
		h=$(getent passwd "$u" | cut -d: -f6)
		if [ ! -x "$h/.local/bin/claude" ]; then
			runuser -u "$u" -- env HOME="$h" bash -c 'curl -fsSL https://claude.ai/install.sh | bash' >/dev/null
		fi
		ln -sf "$h/.local/bin/claude" /usr/local/bin/claude-"$u"
	done
	if [ -n "$CLAUDE_TOKEN_FILE" ]; then
		install -o agent -g agent -m 600 "$CLAUDE_TOKEN_FILE" "$ETC/secrets/claude-token"
	elif [ ! -s "$ETC/secrets/claude-token" ] && [ ! -s "$VAR/agent/.claude/.credentials.json" ] && [ -z "$YES" ] && [ -t 0 ]; then
		echo "The agent needs a Claude Code token: on any computer where you use Claude Code, run"
		echo "  claude setup-token"
		read -r -s -p "and paste the token here (empty = later): " CT; echo
		[ -z "$CT" ] || printf '%s\n' "$CT" | install -o agent -g agent -m 600 /dev/stdin "$ETC/secrets/claude-token"
	fi
	# The second brain uses the same token unless it gets its own.
	if [ -s "$ETC/secrets/claude-token" ] && [ ! -s "$ETC/secrets/claude-token-brain" ]; then
		install -o brain -g brain -m 600 "$ETC/secrets/claude-token" "$ETC/secrets/claude-token-brain"
	fi
fi

# ------------------------------------------------------------------ first deploy
say "First deploy"
"$OPT/repo/guard/bin/appetito-deploy" || true
systemctl daemon-reload
systemctl enable --now appetito-deploy.timer appetito-deploy.path >/dev/null

# Tracker password: a one-time link, so a password manager can generate and keep it.
SETUP=$(token)
printf '%s %s\n' "$(printf '%s' "$SETUP" | sha256sum | cut -d' ' -f1)" "$(( ($(date +%s) + 86400) * 1000 ))" | install -o tracker -g tracker -m 600 /dev/stdin "$VAR/tracker/setup-token"

if [ "$TAILSCALE" = yes ]; then
	tailscale serve --bg --https=443 http://127.0.0.1:8080 >/dev/null
	tailscale serve --bg --https=8443 http://127.0.0.1:8081 >/dev/null
fi

say "Checks"
"$OPT/current/guard/bin/appetito-checks" || echo "Some checks failed: see above. The monitor opened issues for them." >&2

cat <<EOF

appetito is installed.

  1. Set your tracker password (link valid 24 h):
       $CONFIRM_ORIGIN/setup?token=$SETUP
  2. Open the tracker: $MAIN_ORIGIN   (on a phone: browser menu → Install app)
EOF
if [ "$BACKEND" = claude-code ] && [ ! -s "$ETC/secrets/claude-token" ] && [ ! -s "$VAR/agent/.claude/.credentials.json" ]; then
	cat <<EOF
  3. Give the agent a Claude Code token: run \`claude setup-token\` on a computer where you use
     Claude Code, then here: sudo ./install.sh   (it asks for it; nothing else changes)
EOF
fi
cat <<EOF
  Then move an issue from Backlog to To do: the worker starts at the next :07 or :37 (or press Start now).
EOF
[ "$TAILSCALE" = no ] && echo "  Everything listens on 127.0.0.1 only: expose it yourself (SSH tunnel, WireGuard, …), see docs/network.md."
