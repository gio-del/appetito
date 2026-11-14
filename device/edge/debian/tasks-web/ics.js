// iCalendar and CalDAV helpers of the tasks/calendar web app (issue 019). No DOM here, so
// device/edge/tests/tasks-web.sh can load it in node. Edits change only the properties the app
// owns and keep every other line (VALARM, RRULE, X-…, the "origine:" line of brain's items).
'use strict';
(function (root) {
  const CRLF = '\r\n';

  // Unfolded content lines of an iCalendar text.
  function lines(text) {
    return String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(l => l !== '');
  }

  // Fold to 75 octets (RFC 5545 3.1), counting UTF-8 bytes, never splitting a character.
  function fold(line) {
    const out = []; let cur = ''; let n = 0;
    for (const ch of line) {
      const b = new TextEncoder().encode(ch).length;
      if (n + b > 75) { out.push(cur); cur = ' '; n = 1; }
      cur += ch; n += b;
    }
    out.push(cur);
    return out.join(CRLF);
  }

  function serialize(ls) { return ls.map(fold).join(CRLF) + CRLF; }

  // "NAME;P=V:value" -> { name, params: { P: 'V' }, value } (parameter values may be quoted).
  function parseLine(l) {
    const m = /^([A-Za-z0-9-]+)((?:;[A-Za-z0-9-]+=(?:"[^"]*"|[^;:]*))*):(.*)$/.exec(l);
    if (!m) return null;
    const params = {};
    for (const p of m[2].matchAll(/;([A-Za-z0-9-]+)=("[^"]*"|[^;:]*)/g)) params[p[1].toUpperCase()] = p[2].replace(/^"|"$/g, '');
    return { name: m[1].toUpperCase(), params, value: m[3] };
  }

  // Index range [begin, end] of the first component `type` (BEGIN/END lines included).
  function component(ls, type) {
    const b = ls.indexOf('BEGIN:' + type);
    if (b < 0) return null;
    const e = ls.indexOf('END:' + type, b);
    return e < 0 ? null : { begin: b, end: e };
  }

  // Indexes of the component's own lines named `name` (nested VALARM etc. skipped).
  function ownIndexes(ls, comp, name) {
    const out = []; let depth = 0;
    for (let i = comp.begin + 1; i < comp.end; i++) {
      if (/^BEGIN:/i.test(ls[i])) { depth++; continue; }
      if (/^END:/i.test(ls[i])) { depth--; continue; }
      if (depth === 0) { const p = parseLine(ls[i]); if (p && p.name === name) out.push(i); }
    }
    return out;
  }

  function prop(ls, comp, name) {
    const i = ownIndexes(ls, comp, name)[0];
    return i === undefined ? null : parseLine(ls[i]);
  }

  // Replace every `name` line of the component with `line` (null: remove them). Returns new lines.
  function setProp(ls, comp, name, line) {
    const idx = ownIndexes(ls, comp, name);
    const out = ls.slice();
    for (let k = idx.length - 1; k >= 0; k--) out.splice(idx[k], 1);
    if (line !== null) {
      // Insert where the first old line was, else before the first nested block or END.
      let at = idx.length ? idx[0] : -1;
      if (at < 0) {
        const c = component(out, ls[comp.begin].slice(6));
        at = c.end;
        for (let i = c.begin + 1; i < c.end; i++) if (/^BEGIN:/i.test(out[i])) { at = i; break; }
      }
      out.splice(at, 0, line);
    }
    return out;
  }

  function setProps(ls, type, map) {
    for (const [name, line] of Object.entries(map)) ls = setProp(ls, component(ls, type), name, line);
    return ls;
  }

  const escapeText = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const unescapeText = s => String(s).replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  // Local calendar date "YYYY-MM-DD" (the value of <input type=date>).
  const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const icsDay = iso => iso.replace(/-/g, '');
  const utcStamp = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

  // DTSTART/DUE/… -> { date: Date, allDay }. TZID and floating times are read as this device's
  // wall time (the server and its owner live in the same zone; brain writes TZID=Europe/Rome).
  function parseTime(p) {
    if (!p) return null;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(p.value.trim());
    if (!m) return null;
    if (!m[4]) return { date: new Date(+m[1], m[2] - 1, +m[3]), allDay: true };
    if (m[7]) return { date: new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6])), allDay: false };
    return { date: new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]), allDay: false };
  }

  // "YYYY-MM-DD" + "HH:MM" -> "DTSTART;TZID=…:YYYYMMDDTHHMM00".
  function timeLine(name, iso, hm, tz) {
    return `${name};TZID=${tz}:${icsDay(iso)}T${hm.replace(':', '')}00`;
  }

  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return isoDay(new Date(y, m - 1, d + n));
  }

  function newItem(type, uid, now, props) {
    const st = utcStamp(now);
    return serialize(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//home-server//tasks-web//IT', 'BEGIN:' + type,
      'UID:' + uid, 'DTSTAMP:' + st, 'CREATED:' + st, 'LAST-MODIFIED:' + st,
      ...props.filter(Boolean), 'END:' + type, 'END:VCALENDAR']);
  }

  // Item fields the app shows, from one component of a calendar object.
  function read(text, type) {
    const ls = lines(text);
    const c = component(ls, type);
    if (!c) return null;
    const v = n => { const p = prop(ls, c, n); return p ? unescapeText(p.value) : ''; };
    const rec = ['RRULE', 'RDATE', 'RECURRENCE-ID'].some(n => prop(ls, c, n))
      || ls.filter(l => l === 'BEGIN:' + type).length > 1;
    const raw = n => { const p = prop(ls, c, n); return p ? p.value.trim() : ''; };
    const it = { uid: v('UID'), summary: v('SUMMARY'), description: v('DESCRIPTION'), location: v('LOCATION'), recurring: rec,
      rid: raw('RECURRENCE-ID'), dtstart: raw('DTSTART') };
    if (type === 'VTODO') {
      it.status = v('STATUS') || 'NEEDS-ACTION';
      it.due = parseTime(prop(ls, c, 'DUE'));
      it.completed = parseTime(prop(ls, c, 'COMPLETED'));
    } else {
      it.start = parseTime(prop(ls, c, 'DTSTART'));
      it.end = parseTime(prop(ls, c, 'DTEND'));
      const dur = prop(ls, c, 'DURATION');
      if (!it.end && it.start) it.end = endFromDuration(it.start, dur ? dur.value : null);
    }
    return it;
  }

  // Every instance VEVENT of an expanded calendar-data (Radicale's <C:expand>).
  function instances(text) {
    const ls = lines(text); const out = [];
    let from = 0;
    for (;;) {
      const b = ls.indexOf('BEGIN:VEVENT', from);
      if (b < 0) break;
      const e = ls.indexOf('END:VEVENT', b);
      const it = read(['BEGIN:VCALENDAR', ...ls.slice(b, e + 1), 'END:VCALENDAR'].join('\n'), 'VEVENT');
      if (it) { it.recurring = it.recurring || ls.filter(l => l === 'BEGIN:VEVENT').length > 1; out.push(it); }
      from = e + 1;
    }
    return out;
  }

  // Radicale's <C:expand> repeats the master's UTC time, so after a DST change a weekly 18:00
  // shows at 17:00. For instances not moved on their own (DTSTART = RECURRENCE-ID) of a master
  // with a wall-clock DTSTART (TZID or floating), put back the master's time of day on the
  // instance's local day; the length stays. `master` is the raw (not expanded) object text.
  function fixWallTime(insts, master) {
    const m = instances(master).find(x => !x.rid);
    if (!m || !m.start || m.start.allDay || /Z$/.test(m.dtstart)) return insts;
    const off = -m.start.date.getTimezoneOffset() * 60000;
    return insts.map(i => {
      if (!i.start || i.start.allDay || !i.rid || i.rid !== i.dtstart) return i;
      const u = new Date(i.start.date.getTime() + off);
      const s = new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(),
        m.start.date.getHours(), m.start.date.getMinutes(), m.start.date.getSeconds());
      const len = i.end ? i.end.date - i.start.date : 0;
      return { ...i, start: { date: s, allDay: false }, end: i.end ? { date: new Date(s.getTime() + len), allDay: false } : null };
    });
  }

  function endFromDuration(start, dur) {
    const d = new Date(start.date);
    const m = dur && /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(dur);
    if (!m) { if (start.allDay) d.setDate(d.getDate() + 1); return { date: d, allDay: start.allDay }; }
    d.setDate(d.getDate() + 7 * (+m[1] || 0) + (+m[2] || 0));
    d.setTime(d.getTime() + ((+m[3] || 0) * 3600 + (+m[4] || 0) * 60 + (+m[5] || 0)) * 1000);
    return { date: d, allDay: start.allDay };
  }

  // Todo: done/undone.
  function setDone(text, done, now) {
    const st = utcStamp(now);
    return serialize(setProps(lines(text), 'VTODO', {
      STATUS: done ? 'STATUS:COMPLETED' : 'STATUS:NEEDS-ACTION',
      COMPLETED: done ? 'COMPLETED:' + st : null,
      'PERCENT-COMPLETE': done ? 'PERCENT-COMPLETE:100' : null,
      DTSTAMP: 'DTSTAMP:' + st, 'LAST-MODIFIED': 'LAST-MODIFIED:' + st,
    }));
  }

  // Generic edit: map of NAME -> full line or null; DTSTAMP/LAST-MODIFIED refreshed.
  function edit(text, type, map, now) {
    const st = utcStamp(now);
    return serialize(setProps(lines(text), type, { ...map, DTSTAMP: 'DTSTAMP:' + st, 'LAST-MODIFIED': 'LAST-MODIFIED:' + st }));
  }

  const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>';
  const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"';
  const xml = {
    calendars: `${XML_HEAD}<d:propfind ${NS}><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>`,
    todos: `${XML_HEAD}<c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>`
      + '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>',
    // Same filter without <C:expand>: the raw objects, for fixWallTime.
    raw: (from, to) => `${XML_HEAD}<c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>`
      + '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'
      + `<c:time-range start="${utcStamp(from)}" end="${utcStamp(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
    events: (from, to) => `${XML_HEAD}<c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data>`
      + `<c:expand start="${utcStamp(from)}" end="${utcStamp(to)}"/></c:calendar-data></d:prop>`
      + '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'
      + `<c:time-range start="${utcStamp(from)}" end="${utcStamp(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
  };

  const api = { lines, serialize, parseLine, component, prop, setProp, escapeText, unescapeText, parseTime, timeLine,
    isoDay, icsDay, addDays, utcStamp, newItem, read, instances, fixWallTime, setDone, edit, xml };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ICS = api;
})(this);
