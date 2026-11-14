// Tasks and calendar web app (issue 019): a static page on the Radicale site (Caddy :8445/app/)
// that speaks CalDAV to Radicale, same origin, with the owner's Radicale login. No backend of
// its own: credentials stay in this tab's sessionStorage and go only to Radicale.
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const KEY = 'tasks-web-auth';
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';
const DAV = 'DAV:', CAL = 'urn:ietf:params:xml:ns:caldav';
let auth = null; // { user, basic }
let cals = null; // { todo, event } collection hrefs
let tab = location.hash === '#agenda' ? 'agenda' : 'todo';
let agendaDays = 30;
let todos = [];

try { auth = JSON.parse(sessionStorage.getItem(KEY)); } catch { auth = null; }

const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const fmtDay = d => d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = d => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
const fmtTime = d => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k);
  return e;
}

function showErr(msg) { $('#err').textContent = msg || ''; }

// X-Tasks-App makes Caddy drop WWW-Authenticate, so a wrong password never opens the browser's
// own login prompt; the explicit Authorization header is the only credential sent.
async function dav(method, path, { body, depth, headers = {} } = {}) {
  const h = { Authorization: 'Basic ' + auth.basic, 'X-Tasks-App': '1', ...headers };
  if (depth !== undefined) h.Depth = String(depth);
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/xml; charset=utf-8';
  const r = await fetch(path, { method, headers: h, body, credentials: 'omit', cache: 'no-store' });
  if (r.status === 401) { logout('Utente o password non validi.'); throw new Error('non autorizzato'); }
  return r;
}

// 207 multistatus -> [{ href, etag, data, props: Element }] (successful propstat only).
function multistatus(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return [...doc.getElementsByTagNameNS(DAV, 'response')].map(r => {
    const ok = [...r.getElementsByTagNameNS(DAV, 'propstat')].find(p => /\s200\s/.test(p.getElementsByTagNameNS(DAV, 'status')[0]?.textContent || ''));
    const get = (ns, n) => ok?.getElementsByTagNameNS(ns, n)[0];
    return { href: r.getElementsByTagNameNS(DAV, 'href')[0]?.textContent || '', etag: get(DAV, 'getetag')?.textContent || '',
      data: get(CAL, 'calendar-data')?.textContent || '', props: ok };
  });
}

async function discover() {
  const r = await dav('PROPFIND', `/${encodeURIComponent(auth.user)}/`, { depth: 1, body: ICS.xml.calendars });
  if (r.status !== 207) throw new Error(`calendari non trovati (${r.status})`);
  const found = { todo: [], event: [] };
  for (const x of multistatus(await r.text())) {
    if (!x.props || !x.props.getElementsByTagNameNS(CAL, 'calendar').length) continue;
    const comps = [...x.props.getElementsByTagNameNS(CAL, 'comp')].map(c => c.getAttribute('name'));
    if (comps.includes('VTODO')) found.todo.push({ href: x.href, only: comps.length === 1 });
    if (comps.includes('VEVENT')) found.event.push({ href: x.href, only: comps.length === 1 });
  }
  const pick = a => (a.find(c => c.only) || a[0] || {}).href || null;
  cals = { todo: pick(found.todo), event: pick(found.event) };
}

function logout(msg) {
  sessionStorage.removeItem(KEY); auth = null; cals = null;
  $('#main').hidden = true; $('#login').hidden = false;
  $('#login-err').textContent = msg || '';
}

async function start() {
  $('#login').hidden = true; $('#main').hidden = false;
  try {
    if (!cals) await discover();
    await render();
  } catch (e) { if (auth) showErr('Errore: ' + e.message); }
}

async function render() {
  showErr('');
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('on', b.dataset.tab === tab);
  $('#todo').hidden = tab !== 'todo'; $('#agenda').hidden = tab !== 'agenda';
  if (tab === 'todo') await loadTodos(); else await loadAgenda();
}

// ---- Tasks ----
async function loadTodos() {
  if (!cals.todo) { showErr('Nessun calendario di attività (VTODO) per questo utente.'); return; }
  const r = await dav('REPORT', cals.todo, { depth: 1, body: ICS.xml.todos });
  if (r.status !== 207) throw new Error(`lettura attività (${r.status})`);
  todos = multistatus(await r.text()).filter(x => x.data).map(x => ({ ...x, it: ICS.read(x.data, 'VTODO') })).filter(x => x.it);
  drawTodos();
}

function drawTodos() {
  const today = startOfToday();
  const open = todos.filter(x => x.it.status !== 'COMPLETED' && x.it.status !== 'CANCELLED')
    .sort((a, b) => (a.it.due ? a.it.due.date : Infinity) - (b.it.due ? b.it.due.date : Infinity) || a.it.summary.localeCompare(b.it.summary));
  const done = todos.filter(x => x.it.status === 'COMPLETED')
    .sort((a, b) => (b.it.completed ? b.it.completed.date : 0) - (a.it.completed ? a.it.completed.date : 0)).slice(0, 50);
  const row = x => {
    const d = x.it.due;
    let cls = 'd';
    if (d && x.it.status !== 'COMPLETED') {
      const day = new Date(d.date); day.setHours(0, 0, 0, 0);
      if (day < today) cls += ' late'; else if (+day === +today) cls += ' today';
    }
    const box = el('input', { type: 'checkbox', title: x.it.recurring ? 'Attività ripetuta: si completa dal telefono' : 'Fatta' });
    box.checked = x.it.status === 'COMPLETED'; box.disabled = x.it.recurring;
    box.addEventListener('click', e => { e.stopPropagation(); toggle(x, box.checked); });
    return el('li', { onclick: () => openTodo(x) }, box,
      el('span', { class: 't' }, x.it.summary || '(senza titolo)', x.it.recurring ? ' ↻' : ''),
      d ? el('span', { class: cls }, fmtShort(d.date) + (d.allDay ? '' : ' ' + fmtTime(d.date))) : null);
  };
  $('#todo-list').replaceChildren(...(open.length ? open.map(row) : [el('li', { class: 'empty' }, 'Nessuna attività aperta.')]));
  $('#done-list').replaceChildren(...done.map(row));
  $('#done-list').hidden = !$('#show-done').checked;
}

async function put(href, body, etag) {
  const headers = { 'Content-Type': 'text/calendar; charset=utf-8' };
  if (etag) headers['If-Match'] = etag; else headers['If-None-Match'] = '*';
  const r = await dav('PUT', href, { body, headers });
  if (r.status === 412) throw new Error('modificata nel frattempo da un altro dispositivo: ricarico');
  if (!r.ok) throw new Error(`salvataggio (${r.status})`);
}

async function guarded(fn) {
  try { await fn(); } catch (e) { if (auth) showErr('Errore: ' + e.message); }
  if (auth) await render().catch(e => showErr('Errore: ' + e.message));
}

const toggle = (x, done) => guarded(() => put(x.href, ICS.setDone(x.data, done, new Date()), x.etag));

function newHref(col) {
  const uid = `hs-${crypto.randomUUID()}@web`;
  return { uid, href: col + uid.replace(/@/, '-') + '.ics' };
}

$('#todo-add').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target; const summary = f.summary.value.trim(); if (!summary) return;
  const { uid, href } = newHref(cals.todo);
  const body = ICS.newItem('VTODO', uid, new Date(), ['SUMMARY:' + ICS.escapeText(summary), 'STATUS:NEEDS-ACTION',
    f.due.value ? 'DUE;VALUE=DATE:' + ICS.icsDay(f.due.value) : null]);
  guarded(async () => { await put(href, body); f.reset(); });
});

function openTodo(x) {
  const dlg = $('#todo-dlg'); const f = $('form', dlg);
  f.summary.value = x.it.summary; f.description.value = x.it.description;
  const due0 = x.it.due ? ICS.isoDay(x.it.due.date) : '';
  f.due.value = due0; $('.err', dlg).textContent = '';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'save') return;
    const map = { SUMMARY: 'SUMMARY:' + ICS.escapeText(f.summary.value.trim()),
      DESCRIPTION: f.description.value.trim() ? 'DESCRIPTION:' + ICS.escapeText(f.description.value.trim()) : null };
    // An unchanged day keeps the original DUE line (and its time, if it had one).
    if (f.due.value !== due0) map.DUE = f.due.value ? 'DUE;VALUE=DATE:' + ICS.icsDay(f.due.value) : null;
    guarded(() => put(x.href, ICS.edit(x.data, 'VTODO', map, new Date()), x.etag));
  };
  $('[data-act=delete]', dlg).onclick = () => {
    if (!confirm(`Eliminare «${x.it.summary}»?`)) return;
    dlg.returnValue = 'cancel'; dlg.close();
    guarded(() => del(x.href, x.etag));
  };
  dlg.returnValue = ''; dlg.showModal();
}

async function del(href, etag) {
  const r = await dav('DELETE', href, { headers: etag ? { 'If-Match': etag } : {} });
  if (r.status === 412) throw new Error('modificata nel frattempo da un altro dispositivo: ricarico');
  if (!r.ok && r.status !== 404) throw new Error(`eliminazione (${r.status})`);
}

// ---- Agenda ----
async function loadAgenda() {
  if (!cals.event) { showErr('Nessun calendario di eventi (VEVENT) per questo utente.'); return; }
  const from = startOfToday(); const to = new Date(from); to.setDate(to.getDate() + agendaDays);
  $('#agenda-range').textContent = `Da oggi al ${fmtShort(new Date(to.getTime() - 1))}`;
  const [r, rr] = await Promise.all([dav('REPORT', cals.event, { depth: 1, body: ICS.xml.events(from, to) }),
    dav('REPORT', cals.event, { depth: 1, body: ICS.xml.raw(from, to) })]);
  if (r.status !== 207 || rr.status !== 207) throw new Error(`lettura agenda (${r.status !== 207 ? r.status : rr.status})`);
  const raw = new Map(multistatus(await rr.text()).map(x => [x.href, x.data]));
  const evs = [];
  for (const x of multistatus(await r.text())) {
    if (!x.data) continue;
    let list = ICS.instances(x.data);
    if (list.some(i => i.recurring) && raw.get(x.href)) list = ICS.fixWallTime(list, raw.get(x.href));
    for (const it of list) if (it.start) evs.push({ href: x.href, it });
  }
  evs.sort((a, b) => a.it.start.date - b.it.start.date);
  const groups = new Map();
  for (const ev of evs) {
    const day = new Date(Math.max(ev.it.start.date, from)); day.setHours(0, 0, 0, 0);
    const k = +day; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(ev);
  }
  const out = [];
  for (const [k, list] of groups) {
    const day = new Date(k);
    out.push(el('div', { class: 'day' + (k === +from ? ' today' : '') }, k === +from ? 'Oggi, ' + fmtDay(day) : fmtDay(day)));
    for (const ev of list) {
      const s = ev.it.start; const e = ev.it.end;
      let when = s.allDay ? 'tutto il giorno' : fmtTime(s.date) + (e ? '–' + fmtTime(e.date) : '');
      const multi = e && (e.allDay ? Math.round((e.date - s.date) / 86400000) > 1 : new Date(e.date).toDateString() !== new Date(s.date).toDateString());
      if (multi) when += ` (fino al ${fmtShort(e.allDay ? new Date(e.date - 86400000) : e.date)})`;
      out.push(el('div', { class: 'ev', onclick: () => openEvent(ev.href) }, el('span', { class: 'h' }, when),
        el('span', { class: 't' }, ev.it.summary || '(senza titolo)', ev.it.recurring ? ' ↻' : '',
          ev.it.location ? el('span', { class: 'l' }, ev.it.location) : null)));
    }
  }
  $('#agenda-list').replaceChildren(...(out.length ? out : [el('p', { class: 'empty' }, 'Nessun evento in questo periodo.')]));
}

async function openEvent(href) {
  let x = null;
  if (href) {
    const r = await dav('GET', href).catch(e => { showErr('Errore: ' + e.message); return null; });
    if (!r) return;
    if (!r.ok) { showErr(`Errore: lettura evento (${r.status})`); return; }
    const data = await r.text();
    x = { href, etag: r.headers.get('ETag'), data, it: ICS.read(data, 'VEVENT') };
  }
  const dlg = $('#event-dlg'); const f = $('form', dlg);
  const it = x ? x.it : null;
  const ro = !!(it && it.recurring);
  $('[data-recur]', dlg).hidden = !ro;
  $('[data-act=delete]', dlg).hidden = !x || ro;
  $('button[value=save]', dlg).hidden = ro;
  for (const i of f.querySelectorAll('input, textarea')) i.disabled = ro;
  f.summary.value = it ? it.summary : '';
  f.location.value = it ? it.location : '';
  f.description.value = it ? it.description : '';
  const s = it && it.start; const e = it && it.end;
  f.date.value = s ? ICS.isoDay(s.date) : ICS.isoDay(new Date());
  f.allday.checked = !!(s && s.allDay);
  f.start.value = s && !s.allDay ? hm(s.date) : '09:00';
  f.end.value = e && !e.allDay ? hm(e.date) : (s && !s.allDay ? hm(new Date(s.date.getTime() + 3600000)) : '10:00');
  const sync = () => { $('.times', dlg).hidden = f.allday.checked; };
  f.allday.onchange = sync; sync();
  $('.err', dlg).textContent = '';
  // Keep an unchanged multi-day span: only rewrite DTSTART/DTEND when the user changed them.
  const before = [f.date.value, f.allday.checked, f.start.value, f.end.value].join('|');
  f.onsubmit = ev => {
    if (ev.submitter && ev.submitter.value === 'save' && !f.allday.checked && f.end.value <= f.start.value) {
      ev.preventDefault(); $('.err', dlg).textContent = "L'ora di fine deve venire dopo l'inizio."; }
  };
  dlg.onclose = () => {
    if (dlg.returnValue !== 'save' || ro) return;
    const map = { SUMMARY: 'SUMMARY:' + ICS.escapeText(f.summary.value.trim()),
      LOCATION: f.location.value.trim() ? 'LOCATION:' + ICS.escapeText(f.location.value.trim()) : null,
      DESCRIPTION: f.description.value.trim() ? 'DESCRIPTION:' + ICS.escapeText(f.description.value.trim()) : null };
    if (!x || [f.date.value, f.allday.checked, f.start.value, f.end.value].join('|') !== before) {
      Object.assign(map, f.allday.checked
        ? { DTSTART: 'DTSTART;VALUE=DATE:' + ICS.icsDay(f.date.value), DTEND: 'DTEND;VALUE=DATE:' + ICS.icsDay(ICS.addDays(f.date.value, 1)) }
        : { DTSTART: ICS.timeLine('DTSTART', f.date.value, f.start.value, TZ), DTEND: ICS.timeLine('DTEND', f.date.value, f.end.value, TZ) },
      { DURATION: null });
    }
    if (x) guarded(() => put(x.href, ICS.edit(x.data, 'VEVENT', map, new Date()), x.etag));
    else {
      const { uid, href: nh } = newHref(cals.event);
      const body = ICS.newItem('VEVENT', uid, new Date(), [map.SUMMARY, map.DTSTART, map.DTEND, map.LOCATION, map.DESCRIPTION]);
      guarded(() => put(nh, body));
    }
  };
  $('[data-act=delete]', dlg).onclick = () => {
    if (!confirm(`Eliminare «${it.summary}»?`)) return;
    dlg.returnValue = 'cancel'; dlg.close();
    guarded(() => del(x.href, x.etag));
  };
  dlg.returnValue = ''; dlg.showModal();
}

// ---- Wiring ----
$('#login').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target; const user = f.user.value.trim();
  auth = { user, basic: b64(user + ':' + f.pass.value) };
  $('#login-err').textContent = '';
  try {
    await discover();
    sessionStorage.setItem(KEY, JSON.stringify(auth));
    f.pass.value = '';
    start();
  } catch (err) { if (auth) { $('#login-err').textContent = 'Errore: ' + err.message; auth = null; } }
});
$('#logout').addEventListener('click', () => logout());
$('#reload').addEventListener('click', () => render().catch(e => showErr('Errore: ' + e.message)));
$('#show-done').addEventListener('change', drawTodos);
$('#event-new').addEventListener('click', () => openEvent(null));
$('#agenda-more').addEventListener('click', () => { agendaDays += 30; render().catch(e => showErr('Errore: ' + e.message)); });
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => {
  tab = b.dataset.tab; history.replaceState(null, '', tab === 'agenda' ? '#agenda' : '#'); render().catch(e => showErr('Errore: ' + e.message));
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && auth && cals) render().catch(() => {}); });

if (auth) start(); else logout();
