#!/bin/sh
# Install brain's loopback firewall (issue 044) as a Magisk service.d script and (re)start it.
# On the server: through `sudo android-sh` (no USB). From the PC: over adb.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
INSTALL='set -e; S=/data/adb/service.d/brain-fw.sh; mkdir -p /data/adb/service.d; cp $SRC/brain-fw.sh $S; chown root:root $S; chmod 700 $S; [ -f /data/adb/brain-fw.pid ] && kill $(cat /data/adb/brain-fw.pid) 2>/dev/null || true; $S apply; nohup $S >/dev/null 2>&1 & echo started'
if [ -f /etc/home-server.env ]; then
	# Inside the chroot: the repo is visible to Android under /data/local/debian.
	sudo android-sh "SRC=/data/local/debian$HERE; $INSTALL"
else
	ADB=${ADB:-$HOME/platform-tools/adb}
	$ADB push "$HERE/brain-fw.sh" /data/local/tmp/ >/dev/null
	$ADB shell "su -c 'SRC=/data/local/tmp; $INSTALL; rm -f \$SRC/brain-fw.sh'"
fi
