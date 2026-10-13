# A disposable "fresh box" for the e2e: the distro's own image plus systemd as PID 1, git and curl
# (what a stranger has before cloning). Nothing of appetito is pre-installed.
ARG BASE=debian:trixie
FROM ${BASE}
ENV container=docker LANG=C.UTF-8
RUN apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
      systemd systemd-sysv dbus ca-certificates curl git \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 && systemctl mask getty@tty1.service console-getty.service systemd-logind.service systemd-udevd.service \
      systemd-udevd-control.socket systemd-udevd-kernel.socket dev-hugepages.mount sys-fs-fuse-connections.mount >/dev/null 2>&1 || true
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
