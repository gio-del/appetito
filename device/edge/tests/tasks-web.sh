#!/bin/sh
# Test of the iCalendar helpers of the tasks/calendar web app (issue 019, tasks-web/ics.js):
# reading, completing and editing keep every line the app does not own (VALARM, RRULE, X-…).
# Offline, no Radicale. From the repo root: device/edge/tests/tasks-web.sh
set -eu
TZ=Europe/Rome node -e '
const assert = require("assert");
const I = require(process.argv[1]);
const now = new Date(Date.UTC(2026, 9, 15, 8, 30, 0));
const src = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//brain//IT", "BEGIN:VTODO", "UID:hs-1@brain",
  "DTSTAMP:20261012T100000Z", "SUMMARY:Comprare il latte\\, pane", "DESCRIPTION:riga uno\\norigine: [[Archive/Inbox/x]]",
  "DUE;TZID=Europe/Rome:20261016T180000", "STATUS:NEEDS-ACTION", "X-CUSTOM:tienimi",
  "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:allarme", "TRIGGER:-PT1H", "END:VALARM",
  "END:VTODO", "END:VCALENDAR"].join("\r\n") + "\r\n";

let t = I.read(src, "VTODO");
assert.equal(t.summary, "Comprare il latte, pane");
assert.equal(t.description, "riga uno\norigine: [[Archive/Inbox/x]]");
assert.equal(t.due.allDay, false);
assert.equal(t.due.date.getHours(), 18);
assert.equal(t.recurring, false);

const done = I.setDone(src, true, now);
t = I.read(done, "VTODO");
assert.equal(t.status, "COMPLETED");
assert.match(done, /\r\nCOMPLETED:20261015T083000Z\r\n/);
assert.match(done, /PERCENT-COMPLETE:100/);
assert.match(done, /X-CUSTOM:tienimi/);
assert.match(done, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:allarme\r\nTRIGGER:-PT1H\r\nEND:VALARM/);
assert.ok(done.indexOf("COMPLETED:") < done.indexOf("BEGIN:VALARM"), "new props go before nested blocks");
const undone = I.setDone(done, false, now);
assert.equal(I.read(undone, "VTODO").status, "NEEDS-ACTION");
assert.doesNotMatch(undone, /COMPLETED:|PERCENT-COMPLETE/);

// Editing the description replaces the VTODO one, never the VALARM one.
const ed = I.edit(src, "VTODO", { DESCRIPTION: null, SUMMARY: "SUMMARY:" + I.escapeText("a;b,c\\d") }, now);
assert.equal(I.read(ed, "VTODO").summary, "a;b,c\\d");
assert.equal(I.read(ed, "VTODO").description, "");
assert.match(ed, /DESCRIPTION:allarme/);
assert.match(ed, /DUE;TZID=Europe\/Rome:20261016T180000/);

// Folding at 75 octets, multi-byte safe, and unfolding back.
const long = "SUMMARY:" + "àèìòù ".repeat(30);
const f = I.serialize(["BEGIN:VCALENDAR", "BEGIN:VTODO", long, "END:VTODO", "END:VCALENDAR"]);
for (const l of f.split("\r\n")) assert.ok(Buffer.byteLength(l) <= 75, "folded line too long");
assert.equal(I.lines(f)[2], long);

// New all-day/timed items and expanded instances (Radicale <C:expand>).
const ev = I.newItem("VEVENT", "u@web", now, ["SUMMARY:Cena", I.timeLine("DTSTART", "2026-10-20", "20:30", "Europe/Rome"), null]);
assert.match(ev, /DTSTART;TZID=Europe\/Rome:20261020T203000\r\n/);
assert.equal(I.read(ev, "VEVENT").end.date - I.read(ev, "VEVENT").start.date, 0, "no DTEND/DURATION: zero length");
assert.equal(I.addDays("2026-10-31", 1), "2026-11-01");
const exp = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:r", "SUMMARY:Palestra", "DTSTART:20261016T160000Z", "DURATION:PT1H",
  "RECURRENCE-ID:20261016T160000Z", "END:VEVENT", "BEGIN:VEVENT", "UID:r", "SUMMARY:Palestra", "DTSTART:20261023T160000Z",
  "DURATION:PT1H", "RECURRENCE-ID:20261023T160000Z", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const ins = I.instances(exp);
assert.equal(ins.length, 2);
assert.ok(ins.every(i => i.recurring));
assert.equal(ins[0].start.date.getHours(), 18);
assert.equal(ins[0].end.date - ins[0].start.date, 3600000);
const day = I.read("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261025\nEND:VEVENT\nEND:VCALENDAR", "VEVENT");
assert.ok(day.start.allDay && day.end.allDay);
assert.equal(I.isoDay(day.end.date), "2026-10-26");
assert.match(I.xml.events(now, now), /<c:expand start="20261015T083000Z"/);
// DST: Radicale expands a weekly 18:00 Europe/Rome as 16:00Z every week; after 25/10 it must stay 18:00.
const master = I.newItem("VEVENT", "w@web", now, ["SUMMARY:Palestra", "RRULE:FREQ=WEEKLY;COUNT=3",
  I.timeLine("DTSTART", "2026-10-15", "18:00", "Europe/Rome"), I.timeLine("DTEND", "2026-10-15", "19:00", "Europe/Rome")]);
const naive = I.instances(["BEGIN:VCALENDAR", ...["15", "22", "29"].flatMap(d => ["BEGIN:VEVENT", "UID:w@web", "SUMMARY:Palestra",
  `DTSTART:202610${d}T160000Z`, `DTEND:202610${d}T170000Z`, `RECURRENCE-ID:202610${d}T160000Z`, "END:VEVENT"]), "END:VCALENDAR"].join("\r\n"));
const fixed = I.fixWallTime(naive, master);
assert.deepEqual(fixed.map(i => [i.start.date.getDate(), i.start.date.getHours(), (i.end.date - i.start.date) / 60000]), [[15, 18, 60], [22, 18, 60], [29, 18, 60]]);
console.log("tasks-web: ok");
' "$(pwd)/device/edge/debian/tasks-web/ics.js"
