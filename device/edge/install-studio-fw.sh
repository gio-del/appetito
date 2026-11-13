#!/bin/sh
# Install the study session's firewall (issue 448) as a Magisk service.d script and (re)start it.
# On the server: through `sudo android-sh` (no USB). From the PC: over adb. Same as install-brain-fw.sh.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
INSTALL='set -e; S=/data/adb/service.d/studio-fw.sh; mkdir -p /data/adb/service.d; cp $SRC/studio-fw.sh $S; chown root:root $S; chmod 700 $S; [ -f /data/adb/studio-fw.pid ] && kill $(cat /data/adb/studio-fw.pid) 2>/dev/null || true; $S apply; nohup $S >/dev/null 2>&1 & echo started'
if [ -f /etc/home-server.env ]; then
	# Inside the chroot: the repo is visible to Android under /data/local/debian.
	sudo android-sh "SRC=/data/local/debian$HERE; $INSTALL"
else
	ADB=${ADB:-$HOME/platform-tools/adb}
	$ADB push "$HERE/studio-fw.sh" /data/local/tmp/ >/dev/null
	$ADB shell "su -c 'SRC=/data/local/tmp; $INSTALL; rm -f \$SRC/studio-fw.sh'"
fi
