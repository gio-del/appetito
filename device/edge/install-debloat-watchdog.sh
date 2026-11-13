#!/bin/sh
# Install the debloat watchdog + lists on the Android side and (re)start it.
# On the server: through `sudo android-sh` (no USB). From the PC: over adb.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
INSTALL='set -e; D=/data/adb/debloat; S=/data/adb/service.d/debloat-watchdog.sh; mkdir -p $D /data/adb/service.d; cp $SRC/deny.txt $SRC/allow-3p.txt $D/; cp $SRC/debloat-watchdog.sh $S; chown -R root:root $D $S; chmod 700 $D $S; chmod 600 $D/deny.txt $D/allow-3p.txt; [ -f $D/pid ] && kill $(cat $D/pid) 2>/dev/null || true; nohup $S >/dev/null 2>&1 & echo started'
if [ -f /etc/home-server.env ]; then
	# Stage on disk (not the chroot's /tmp tmpfs, which Android can't see).
	T=$(mktemp -d /var/tmp/debloat.XXXXXX)
	grep -vE '^[[:space:]]*(#|$)' "$HERE/../../scripts/edge-debloat.txt" > "$T/deny.txt"
	cp "$HERE/allow-3p.txt" "$HERE/debloat-watchdog.sh" "$T/"
	sudo android-sh "SRC=/data/local/debian$T; $INSTALL"
	rm -rf "$T"
else
	ADB=${ADB:-$HOME/platform-tools/adb}
	TMP=$(mktemp -d)
	grep -vE '^[[:space:]]*(#|$)' "$HERE/../../scripts/edge-debloat.txt" > "$TMP/deny.txt"
	$ADB push "$TMP/deny.txt" "$HERE/allow-3p.txt" "$HERE/debloat-watchdog.sh" /data/local/tmp/ >/dev/null
	rm -r "$TMP"
	$ADB shell "su -c 'SRC=/data/local/tmp; $INSTALL'"
fi
