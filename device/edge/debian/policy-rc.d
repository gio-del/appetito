#!/bin/sh
# /usr/sbin/policy-rc.d: in this chroot services are run by runit (and sshd/tailscaled
# by debian.sh), never by package maintainer scripts. Deny every invoke-rc.d action so
# an upgrade can't start a second daemon; restart-stale restarts what was upgraded.
exit 101
