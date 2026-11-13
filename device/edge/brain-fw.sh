#!/system/bin/sh
# Magisk service.d script (issue 044): limit what brain (uid 900, the second brain's user in the
# Debian chroot, which reads untrusted material) can reach on this host. On the loopback interface
# (127.0.0.1, ::1 and the LAN IP: local traffic always leaves through lo) brain may open only
# Radicale (tcp 5232) and the tracker (tcp 3004); everything else local (Syncthing, AdGuard,
# Vaultwarden, Caddy, tailscaled's proxy, sshd...) gets a reset. Internet traffic (Anthropic,
# DNS to 1.1.1.1) is untouched.
# Own chain hs_brain, jumped to first from OUTPUT. Applied at boot, then re-checked every
# $INTERVAL seconds in case netd rebuilds OUTPUT.
# Usage: brain-fw.sh [apply|remove|status]; no argument = boot mode (apply + keep re-checking).
BRAIN_UID=900
ALLOW_TCP=5232,3004
INTERVAL=300
CHAIN=hs_brain
PID=/data/adb/brain-fw.pid

jump() { "$1" -w "$2" OUTPUT -o lo -m owner --uid-owner $BRAIN_UID -j $CHAIN; }

build() { # $1 = iptables|ip6tables, $2 = loopback address
  "$1" -w -N $CHAIN 2>/dev/null
  "$1" -w -F $CHAIN
  "$1" -w -A $CHAIN -m state --state ESTABLISHED,RELATED -j RETURN
  "$1" -w -A $CHAIN -d "$2" -p tcp -m multiport --dports $ALLOW_TCP -j RETURN
  "$1" -w -A $CHAIN -p tcp -j REJECT --reject-with tcp-reset
  "$1" -w -A $CHAIN -j REJECT
}

ensure() { # rebuild only what is missing, so a running check never opens a gap
  for t in "iptables 127.0.0.1" "ip6tables ::1"; do
    set -- $t
    "$1" -w -S $CHAIN 2>/dev/null | grep -q REJECT || build "$1" "$2"
    jump "$1" -C 2>/dev/null || jump "$1" -I  # -I without a position = first rule
  done
}

remove() {
  for t in iptables ip6tables; do
    while jump $t -D 2>/dev/null; do :; done
    $t -w -F $CHAIN 2>/dev/null; $t -w -X $CHAIN 2>/dev/null
  done
}

case "$1" in
  apply) for t in "iptables 127.0.0.1" "ip6tables ::1"; do set -- $t; build "$1" "$2"; done; ensure ;;
  remove) remove ;;
  status) for t in iptables ip6tables; do $t -w -S OUTPUT | grep $CHAIN; $t -w -S $CHAIN; done ;;
  "")
    echo $$ > $PID
    until [ "$(getprop sys.boot_completed)" = 1 ]; do sleep 5; done
    ensure
    while sleep $INTERVAL; do ensure; done ;;
  *) echo "usage: $0 [apply|remove|status]"; exit 1 ;;
esac
