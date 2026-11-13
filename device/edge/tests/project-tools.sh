#!/bin/sh
# Test of project-tools (issue 231) with a stubbed download, and of the tools PATH in project-run.
# From the repo root: device/edge/tests/project-tools.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'chmod -R u+w "$t" 2> /dev/null; rm -rf "$t"' EXIT
export GIT_CONFIG_GLOBAL=$t/gitconfig GIT_CONFIG_SYSTEM=/dev/null
git config --global user.email t@t; git config --global user.name t; git config --global init.defaultBranch main
git init -q --bare "$t/up"; mkdir -p "$t/proj"; git clone -q "$t/up" "$t/proj/p" 2> /dev/null
P=$R/device/edge/debian/project-tools
fail() { echo "FAIL: $1"; exit 1; }
case $(uname -m) in aarch64 | arm64) plat=linux-arm64 ;; *) plat=linux-amd64 ;; esac
# stub download: every URL gives the same small script
printf '#!/bin/sh\necho "$1" > "$2"\n' > "$t/fetch"; chmod +x "$t/fetch"
printf '#!/bin/sh\necho hello-tool\n' > "$t/payload"
sed -i 's|echo "\$1" > "\$2"|cp '"$t"'/payload "$2"|' "$t/fetch"
sha=$(sha256sum "$t/payload" | cut -d' ' -f1)
export HS_TOOLS_ROOT=$t/opt HS_PROJECTS_DIR=$t/proj HS_TOOLS_FETCH=$t/fetch
run() { sh "$P" p "$1"; }
commit() { printf '%s\n' "$1" > "$t/proj/p/.hs-tools"; git -C "$t/proj/p" add .hs-tools; git -C "$t/proj/p" commit -qm c; git -C "$t/proj/p" push -q origin HEAD:main; git -C "$t/proj/p" rev-parse HEAD; }
rejects() { c=$(commit "$1"); run "$c" > /dev/null 2>&1 && fail "accepted: $2"; [ -z "$(ls "$t/opt/p" 2> /dev/null)" ] || fail "installed anyway: $2"; return 0; }

good="mytool 1.2.3 $plat $sha https://example.com/mytool"
c=$(commit "$good")
run "$c" | grep -q "installato mytool" || fail "no install"
[ "$($t/opt/p/mytool-1.2.3/bin/mytool)" = hello-tool ] || fail "tool does not run"
[ -w "$t/opt/p/mytool-1.2.3/bin/mytool" ] && fail "tool writable"
run "$c" | grep -q "già installato" || fail "not idempotent"
# ignores the working tree: only the commit counts
echo "evil 1 $plat $sha https://example.com/e" > "$t/proj/p/.hs-tools"
run "$c" | grep -q evil && fail "read the working tree"
git -C "$t/proj/p" checkout -q .hs-tools
chmod -R u+w "$t/opt"; rm -rf "$t/opt"
rejects "mytool 1.2.3 $plat 0000000000000000000000000000000000000000000000000000000000000000 https://example.com/mytool" "wrong sha"
rejects "mytool 1.2.3 $plat $sha http://example.com/mytool" "http URL"
rejects "../x 1.2.3 $plat $sha https://example.com/x" "bad name"
rejects "mytool ../1 $plat $sha https://example.com/x" "bad version"
rejects "mytool 1 $plat $sha https://example.com/x;id" "bad URL char"
rejects "mytool 1 linux-mips $sha https://example.com/x" "bad platform"
rejects "mytool 1 $plat abc https://example.com/x" "short sha"
sh "$P" '../p' HEAD 2> /dev/null && fail "bad project name"
# issue 234: a tool in a bin/ directory of its archive exposes that directory, companions included
mkdir -p "$t/arc/kit-1/bin"
printf '#!/bin/sh\necho kit\n' > "$t/arc/kit-1/bin/kit"; printf '#!/bin/sh\necho helper\n' > "$t/arc/kit-1/bin/helper"
chmod +x "$t/arc/kit-1/bin/"*
tar -czf "$t/kit.tar.gz" -C "$t/arc" kit-1
printf '#!/bin/sh\ncp %s "$2"\n' "$t/kit.tar.gz" > "$t/fetchkit"; chmod +x "$t/fetchkit"
ks=$(sha256sum "$t/kit.tar.gz" | cut -d' ' -f1)
c=$(commit "kit 1 $plat $ks https://example.com/kit.tar.gz")
HS_TOOLS_FETCH=$t/fetchkit run "$c" | grep -q "installato kit" || fail "no install of an archive"
[ "$($t/opt/p/kit-1/bin/kit)" = kit ] || fail "archive tool does not run"
[ "$($t/opt/p/kit-1/bin/helper)" = helper ] || fail "companion in bin/ not exposed"
chmod -R u+w "$t/opt"; rm -rf "$t/opt"
# project-run puts the tools first in PATH
if sudo -n true 2> /dev/null; then
	c=$(commit "$good"); run "$c" > /dev/null
	mkdir -p "$t/work"; chmod 700 "$t/work"; chmod 755 "$t"
	export HS_WORK_DIR=$t/work HS_PROJECTS_DIR=$t/proj
	d=$(sh "$R/device/edge/debian/project-worktree" create p 8 t)
	printf 'p | https://x/p.git | - | active | - | -\n' > "$t/projects"
	out=$(sudo -n env HS_PROJECTS_FILE="$t/projects" HS_WORK_DIR="$t/work" HS_USER=$(id -un) HS_TOOLS_ROOT="$t/opt" sh "$R/device/edge/debian/project-run" p "$d" sh -c 'mytool') || fail "project-run mytool"
	[ "$out" = hello-tool ] || fail "PATH: $out"
fi
echo ok
