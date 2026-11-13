#!/bin/sh
# Test of debian/dashboard-stats (issue 109) with fake /proc and a fake AdGuard (node): system.json
# numbers, adguard.json numbers only (no password), a failing AdGuard keeps the old file and exits 1.
# Run from the repo root: device/edge/tests/dashboard-stats.sh
set -eu
S=$PWD/device/edge/debian/dashboard-stats
t=$(mktemp -d); trap 'kill $pid 2>/dev/null || true; rm -rf "$t"' EXIT
fail() { echo "FAIL: dashboard-stats: $*"; cat "$t/err" 2>/dev/null; exit 1; }
cat > "$t/srv.js" <<'JS'
const http = require('http'), fs = require('fs');
http.createServer((q, r) => { fs.writeFileSync(process.argv[2], q.headers.authorization || '');
  if (process.env.FAIL) { r.statusCode = 500; return r.end('x'); }
  r.end(JSON.stringify({ num_dns_queries: 2000, num_blocked_filtering: 500, avg_processing_time: 0.0123 })); })
  .listen(0, '127.0.0.1', function () { fs.writeFileSync(process.argv[3], String(this.address().port)); });
JS
node "$t/srv.js" "$t/auth" "$t/port" & pid=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$t/port" ] && break; sleep 0.3; done
mkdir -p "$t/proc" "$t/out"
printf 'cpu  100 0 100 800 0 0 0 0 0 0\n' > "$t/proc/stat"
printf 'MemTotal: 8000000 kB\nMemAvailable: 6000000 kB\n' > "$t/proc/meminfo"
echo "3600.5 100" > "$t/proc/uptime"
echo "s3cretpw" > "$t/pw"
run() { env HS_HEALTH_PROBES="Fake http://127.0.0.1:$(cat "$t/port")/x
Down http://127.0.0.1:9/x" HS_SERVICE_DIR=$t/sv HS_STATS_DIR=$t/out HS_PROC_DIR=$t/proc HS_ADGUARD_PW=$t/pw HS_USER=gio HS_ADGUARD_URL=http://127.0.0.1:$(cat "$t/port") sh "$S" 2> "$t/err"; }
# 1. normal run (the fake stat does not move: 0 % CPU)
run || fail "run"
[ "$(jq -r '[.cpu, .mem_total, .mem_used, .uptime] | join("|")' "$t/out/system.json")" = "0.0|8192000000|2048000000|3600" ] || fail "system: $(cat "$t/out/system.json")"
[ "$(jq -r '.disk_total > 0 and .disk_used > 0' "$t/out/system.json")" = true ] || fail "disk"
[ "$(jq -r '[.queries, .blocked, .blocked_pct, .latency_ms] | join("|")' "$t/out/adguard.json")" = "2000|500|25|12.3" ] || fail "adguard: $(cat "$t/out/adguard.json")"
grep -q s3cretpw "$t/out"/*.json && fail "password in output"
[ "$(cat "$t/auth")" = "Basic $(printf 'gio:s3cretpw' | base64)" ] || fail "basic auth"
[ "$(jq -c . "$t/out/health.json" | jq -r '[(.up|join(",")), (.optional|length)]|join("|")')" = "Fake|0" ] || fail "health: $(cat "$t/out/health.json")"
mkdir -p "$t/sv"; touch "$t/sv/ntfy"; run || fail "run2"; [ "$(jq -r '.optional[0]' "$t/out/health.json")" = ntfy ] || fail "optional"
# 2. AdGuard failing: exit 1, old adguard.json kept, system.json still written
kill $pid; env FAIL=1 node "$t/srv.js" "$t/auth" "$t/port" & pid=$!; sleep 1
old=$(cat "$t/out/adguard.json"); rm -f "$t/port"
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$t/port" ] && break; sleep 0.3; done
if run; then fail "expected exit 1"; fi
[ "$(cat "$t/out/adguard.json")" = "$old" ] || fail "old adguard.json not kept"
# 3. no password file: system only, exit 0
rm -f "$t/pw" "$t/out/adguard.json"; run || fail "no pw run"; [ ! -e "$t/out/adguard.json" ] || fail "adguard written without pw"
# 4. history.jsonl (issue 338): one sample, none again within 5 minutes, one more after, capped at 7 days
H=$t/out/history.jsonl
echo '{"level": 80, "status": "In scarica", "battery_temp": 31.5, "cpu_temp": 42.0}' > "$t/out/status.json"
rm -f "$H"; run || true; run || true
[ "$(wc -l < "$H")" = 1 ] || fail "history: expected 1 sample, got $(wc -l < "$H")"
[ "$(jq -r '[.bat, .st, .bt, .ct, .ram] | join("|")' "$H")" = "80|In scarica|31.5|42.0|25" ] || fail "history sample: $(cat "$H")"
sed -i 's/"t":[0-9]*/"t":1000/' "$H"; run || true
[ "$(wc -l < "$H")" = 2 ] || fail "history: no second sample"
sed -i 's/"t":[0-9]*/"t":1000/' "$H"
for _ in $(seq 1 2200); do echo '{"t":1000}'; done >> "$H"
sed -i '$d' "$H"; echo '{"t":1000}' >> "$H"; run || true
[ "$(wc -l < "$H")" -le 2017 ] || fail "history not capped: $(wc -l < "$H")"
[ "$(wc -c < "$H")" -lt 1048576 ] || fail "history too big"
# 5. disk-daily.jsonl + disk-eta.json (issue 357): one daily sample, none again the same day, a second after a day
D=$t/out/disk-daily.jsonl
rm -f "$D" "$t/out/disk-eta.json"; HS_DISK_ETA=$PWD/device/edge/debian/disk-eta; export HS_DISK_ETA
run || true; run || true
[ "$(wc -l < "$D")" = 1 ] || fail "daily: expected 1 sample, got $(wc -l < "$D")"
[ "$(jq -r '.used > 0 and .total > .used' "$D")" = true ] || fail "daily sample: $(cat "$D")"
[ "$(jq -r .state "$t/out/disk-eta.json")" = none ] || fail "eta with one sample: $(cat "$t/out/disk-eta.json")"
sed -i 's/"t": [0-9]*/"t": 1000/' "$D"; run || true
[ "$(wc -l < "$D")" = 2 ] || fail "daily: no second sample"
for _ in $(seq 1 130); do echo '{"t": 1000, "used": 1, "total": 2}'; done >> "$D"; sed -i 's/"t": [0-9]*/"t": 1000/' "$D"; run || true
[ "$(wc -l < "$D")" -le 121 ] || fail "daily not capped: $(wc -l < "$D")"
# 6. adguard-daily.jsonl (issue 435): one row per day, rewritten when run again, numbers only, capped at 90
A=$t/out/adguard-daily.jsonl
kill $pid; node "$t/srv.js" "$t/auth" "$t/port" & pid=$!; rm -f "$t/port"
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$t/port" ] && break; sleep 0.3; done
rm -f "$A"; echo "s3cretpw" > "$t/pw"; run || true; run || true
[ "$(wc -l < "$A")" = 1 ] || fail "adguard-daily: expected 1 row, got $(wc -l < "$A")"
[ "$(jq -r '[.d, .queries, .blocked, .latency_ms] | join("|")' "$A")" = "$(date +%F)|2000|500|12.3" ] || fail "adguard-daily row: $(cat "$A")"
grep -q s3cretpw "$A" && fail "password in adguard-daily"
for i in $(seq 1 100); do echo "{\"d\":\"2020-01-$i\",\"queries\":1}"; done > "$A.new"; cat "$A" >> "$A.new"; mv "$A.new" "$A"; run || true
[ "$(wc -l < "$A")" = 90 ] || fail "adguard-daily not capped: $(wc -l < "$A")"
[ "$(grep -c "$(date +%F)" "$A")" = 1 ] || fail "adguard-daily duplicate day"
echo "ok: dashboard-stats"
