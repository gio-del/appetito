# Sourced by the hooks commit-msg, pre-push and pre-receive (issue 474): $A = hs-attribution, from the repo next
# to this hooks dir (home-server, on the Edge or the PC) or installed (the system-wide copy in
# /usr/local/share/hs-git-hooks, core.hooksPath in /etc/gitconfig, used by every other repo of the server).
# chain NAME ARGS...: run the repo's own .git/hooks/NAME, which a hooksPath would otherwise silence.
A=$(dirname "$0")/../debian/hs-attribution
[ -x "$A" ] || A=$(command -v hs-attribution) || { echo "hs-attribution non trovato: commit e push bloccati (issue 474)" >&2; exit 1; }
chain() {
	n=$1; shift
	h=$(git rev-parse --git-common-dir 2> /dev/null)/hooks/$n
	[ -x "$h" ] && [ "$(cd "$(dirname "$h")" && pwd -P)" != "$(cd "$(dirname "$0")" && pwd -P)" ] || return 0
	"$h" "$@"
}
# $SEC = hs-secrets (issue 529), used by pre-push; HS_SECRETS_CMD overrides it (tests).
SEC=${HS_SECRETS_CMD:-$(dirname "$0")/../debian/hs-secrets}
[ -n "${HS_SECRETS_CMD:-}" ] || [ -f "$SEC" ] || SEC=$(command -v hs-secrets) || SEC=  # missing: pre-push blocks, the other hooks do not need it
