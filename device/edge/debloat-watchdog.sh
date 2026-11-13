#!/system/bin/sh
# Magisk service.d script: keep the Edge at the bare minimum.
# - removes (pm uninstall --user 0) every package in deny.txt that is present
# - removes every third-party app not listed in allow-3p.txt
# Runs at boot, then every $INTERVAL seconds. Log: /data/adb/debloat/log
DIR=/data/adb/debloat
INTERVAL=900
echo $$ > "$DIR/pid"

until [ "$(getprop sys.boot_completed)" = 1 ]; do sleep 10; done
sleep 60

log() { echo "$(date '+%F %T') $*" >> "$DIR/log"; }
pkgs() { grep -vE '^[[:space:]]*(#|$)' "$1"; }

while true; do
  installed=$(pm list packages --user 0 | sed 's/^package://')
  for p in $(pkgs "$DIR/deny.txt"); do
    echo "$installed" | grep -qx "$p" || continue
    r=$(pm uninstall --user 0 "$p" 2>&1 | tail -1)
    if [ "$r" = Success ]; then log "removed $p"
    elif [ ! -f "$DIR/stuck.$p" ]; then log "cannot remove $p: $r"; touch "$DIR/stuck.$p"; fi
  done
  for p in $(pm list packages -3 --user 0 | sed 's/^package://'); do
    pkgs "$DIR/allow-3p.txt" | grep -qx "$p" && continue
    log "removed 3p $p: $(pm uninstall --user 0 "$p" 2>&1 | tail -1)"
  done
  tail -n 500 "$DIR/log" > "$DIR/log.tmp" 2>/dev/null && mv "$DIR/log.tmp" "$DIR/log"
  sleep $INTERVAL
done
