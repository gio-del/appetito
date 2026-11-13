#!/bin/sh
# Install the chroot manager (debian.sh) + Magisk boot hook (debian-boot.sh) on the Android side.
# On the server (Claude Code/SSH on the Edge): runs through `sudo android-sh`, no USB needed.
# From the PC: over adb (fallback when SSH is broken). The rootfs itself lives in /data/local/debian.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
INSTALL='set -e; mkdir -p /data/adb/debian /data/adb/service.d; cp $SRC/debian.sh /data/adb/debian/; cp $SRC/debian-boot.sh /data/adb/service.d/; chown root:root /data/adb/debian /data/adb/debian/debian.sh /data/adb/service.d/debian-boot.sh; chmod 700 /data/adb/debian /data/adb/debian/debian.sh /data/adb/service.d/debian-boot.sh; echo installed'
if [ -f /etc/home-server.env ]; then
	# Inside the chroot: the repo is visible to Android under /data/local/debian.
	sudo android-sh "SRC=/data/local/debian$HERE/debian; $INSTALL"
else
	ADB=${ADB:-$HOME/platform-tools/adb}
	$ADB push "$HERE/debian/debian.sh" "$HERE/debian/debian-boot.sh" /data/local/tmp/ >/dev/null
	$ADB shell "su --mount-master -c 'SRC=/data/local/tmp; $INSTALL; rm -f \$SRC/debian.sh \$SRC/debian-boot.sh'"
fi
