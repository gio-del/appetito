#!/system/bin/sh
# Magisk service.d script (issue 448): what studio (uid 906, the study session's user in the Debian chroot, the only
# Claude with web access on this server) can reach. It keeps the internet (web, Anthropic, DNS to 1.1.1.1/9.9.9.9) and
# gets a reject towards everything local or private: loopback (every local service, tailscaled's proxy), the LAN, the
# tailnet's CGNAT range and link-local addresses, IPv4 and IPv6.
# Own chain hs_studio, jumped to first from OUTPUT for the uid. Applied at boot, then re-checked every $INTERVAL
# seconds in case netd rebuilds OUTPUT. Same structure as brain-fw.sh (issue 044).
# Usage: studio-fw.sh [apply|remove|status]; no argument = boot mode (apply + keep re-checking).
STUDIO_UID=906
INTERVAL=300
CHAIN=hs_studio
PID=/data/adb/studio-fw.pid
V4="127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16"
V6="::1/128 fc00::/7 fe80::/10"

jump() { "$1" -w "$2" OUTPUT -m owner --uid-owner $STUDIO_UID -j $CHAIN; }

build() { # $1 = iptables|ip6tables, $2 = the blocked ranges
  "$1" -w -N $CHAIN 2>/dev/null
  "$1" -w -F $CHAIN
  for n in $2; do
    "$1" -w -A $CHAIN -d "$n" -p tcp -j REJECT --reject-with tcp-reset
    "$1" -w -A $CHAIN -d "$n" -j REJECT
  done
}

ensure() { # rebuild only what is missing, so a running check never opens a gap
  for t in "iptables=$V4" "ip6tables=$V6"; do
    ipt=${t%%=*}; nets=${t#*=}
    "$ipt" -w -S $CHAIN 2>/dev/null | grep -q REJECT || build "$ipt" "$nets"
    jump "$ipt" -C 2>/dev/null || jump "$ipt" -I  # -I without a position = first rule
  done
}

remove() {
  for t in iptables ip6tables; do
    while jump $t -D 2>/dev/null; do :; done
    $t -w -F $CHAIN 2>/dev/null; $t -w -X $CHAIN 2>/dev/null
  done
}

case "$1" in
  apply) build iptables "$V4"; build ip6tables "$V6"; ensure ;;
  remove) remove ;;
  status) for t in iptables ip6tables; do $t -w -S OUTPUT | grep $CHAIN; $t -w -S $CHAIN; done ;;
  "")
    echo $$ > $PID
    until [ "$(getprop sys.boot_completed)" = 1 ]; do sleep 5; done
    ensure
    while sleep $INTERVAL; do ensure; done ;;
  *) echo "usage: $0 [apply|remove|status]"; exit 1 ;;
esac
