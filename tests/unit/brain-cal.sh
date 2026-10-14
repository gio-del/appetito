#!/bin/sh
# core/brain/bin/brain-cal: off unless a calendar is configured, loopback only, and against a stand-in
# CalDAV server: add refuses an existing UID, edit needs one, items are validated before any request.
set -eu
BC=$(cd "$(dirname "$0")/../.." && pwd)/core/brain/bin/brain-cal
T=$(mktemp -d); trap 'kill "$srv" 2>/dev/null || true; rm -rf "$T"' EXIT
n=0
ok() { n=$((n + 1)); echo "ok $n $1"; }
die() { echo "FAIL: $1"; exit 1; }
export APPETITO_ENV_FILE=$T/env APPETITO_CALDAV_PASSWORD_FILE=$T/pw
echo secret > "$T/pw"
ics() { printf 'BEGIN:VCALENDAR\nBEGIN:%s\nUID:%s\nSUMMARY:x\nEND:%s\nEND:VCALENDAR\n' "$2" "$1" "$2"; }

: > "$T/env"
if sh "$BC" list calendar 2>"$T/err"; then die "ran without a calendar"; fi
grep 'no calendar configured' "$T/err" >/dev/null || die "no 'not configured' message"
ok "off unless APPETITO_CALDAV_URL is set"

echo 'APPETITO_CALDAV_URL=https://cal.example.invalid/owner' > "$T/env"
if sh "$BC" list calendar 2>"$T/err"; then die "accepted a non-loopback URL"; fi
grep '127.0.0.1' "$T/err" >/dev/null || die "no loopback message"
ok "refuses a calendar outside 127.0.0.1"

# Stand-in CalDAV: PUT honours If-None-Match: *, GET answers for stored items.
port=$((20000 + $$ % 20000))
node -e '
const items = new Map();
require("http").createServer((q, r) => {
	let b = ""; q.on("data", d => b += d); q.on("end", () => {
		if (q.method === "PUT") { if (q.headers["if-none-match"] === "*" && items.has(q.url)) { r.writeHead(412); return r.end(); } const had = items.has(q.url); items.set(q.url, b); r.writeHead(had ? 204 : 201); return r.end(); }
		if (items.has(q.url)) { r.writeHead(200); return r.end(items.get(q.url)); }
		r.writeHead(q.url.endsWith("/") ? 207 : 404); r.end([...items.values()].join(""));
	});
}).listen(+process.argv[1], "127.0.0.1");' "$port" & srv=$!
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.1; done
echo "APPETITO_CALDAV_URL=http://127.0.0.1:$port/owner" > "$T/env"

ics ev1 VEVENT > "$T/ev1.ics"
sh "$BC" add calendar "$T/ev1.ics" | grep 'ok: calendar/ev1' >/dev/null || die "add failed"
ok "add puts a new event"
if sh "$BC" add calendar "$T/ev1.ics" 2>"$T/err"; then die "add overwrote an existing UID"; fi
grep 'already exists' "$T/err" >/dev/null || die "no 'already exists' message"
ok "add refuses an existing UID"
sh "$BC" edit calendar "$T/ev1.ics" | grep 'ok: calendar/ev1' >/dev/null || die "edit of an existing item failed"
ics ev2 VEVENT > "$T/ev2.ics"
if sh "$BC" edit calendar "$T/ev2.ics" 2>/dev/null; then die "edit created an item"; fi
ok "edit replaces an existing item and refuses a missing one"

ics 'bad uid/..' VEVENT > "$T/bad.ics"
if sh "$BC" add calendar "$T/bad.ics" 2>/dev/null; then die "accepted a UID with / and spaces"; fi
ics t1 VTODO > "$T/t1.ics"
if sh "$BC" add calendar "$T/t1.ics" 2>/dev/null; then die "a task went into the calendar"; fi
echo hello > "$T/plain.ics"
if sh "$BC" add tasks "$T/plain.ics" 2>/dev/null; then die "accepted a non-iCalendar file"; fi
sh "$BC" add tasks "$T/t1.ics" | grep 'ok: tasks/t1' >/dev/null || die "a task didn't go into tasks"
ok "items are validated: UID characters, the collection's component, iCalendar"
