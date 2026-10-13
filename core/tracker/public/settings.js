// Settings: a form over the tracker's fixed settings schema (GET/PUT /api/settings). The server
// validates every value; this page only shows them. Labels come in both languages from the schema.
'use strict';
const form = document.getElementById('st-form');
const list = document.getElementById('st-list');
const msg = document.getElementById('st-msg');
const okMsg = document.getElementById('st-ok');
let schema = {};

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const tr = v => (v && typeof v === 'object' ? v[LANG] || v.en : v);
const shown = (s, v) => s.type === 'bool' ? t(v ? 'st.yes' : 'st.no') : `${v}${s.unit === '%' ? '%' : s.unit === 'h' ? ':00' : s.unit ? ' ' + s.unit : ''}`;

function input(key, s, v) {
  let i;
  if (s.type === 'bool') { i = el('input'); i.type = 'checkbox'; i.checked = v; }
  else if (s.type === 'enum') { i = el('select'); for (const o of s.values) i.append(new Option(o, o, false, o === v)); }
  else if (s.type === 'time') { i = el('input'); i.type = 'time'; i.value = v; }
  else if (s.type === 'text') { i = el('input'); i.type = 'text'; i.maxLength = 64; i.required = true; i.value = v; }
  else { i = el('input'); i.type = 'number'; i.min = s.min; i.max = s.max; i.step = 1; i.required = true; i.inputMode = 'numeric'; i.value = v; }
  i.id = 'st-' + key; i.name = key;
  return i;
}

function texts() {
  document.title = t('st.title');
  document.getElementById('st-h').textContent = t('st.title');
  document.getElementById('st-intro').textContent = t('st.intro');
  document.getElementById('st-save').textContent = t('st.save');
  document.getElementById('st-back').textContent = '← ' + t('st.back');
}

function render(data) {
  if (data.lang) setLang(data.lang);
  texts();
  schema = data.schema;
  list.replaceChildren();
  let group = null;
  for (const [key, s] of Object.entries(schema)) {
    if (s.group !== group) { group = s.group; list.append(el('h2', 'st-group', t('st.group.' + group))); }
    const row = el('div', 'pa-row st-row');
    const info = el('div', 'pa-info');
    const label = el('label', 'pa-name', tr(s.label) + (s.unit && s.unit !== 'h' ? ` (${s.unit})` : ''));
    label.htmlFor = 'st-' + key;
    info.append(label, el('div', 'muted small', tr(s.desc)));
    const extra = s.type === 'int' ? t('st.range', s.min, s.max) : '';
    info.append(el('div', 'muted small', extra + t('st.default', shown(s, s.default)) + (data.set.includes(key) ? '' : t('st.inuse'))));
    row.append(info, input(key, s, data.values[key]));
    list.append(row);
  }
  form.hidden = false;
  const g = document.getElementById('st-gate');
  g.replaceChildren(el('h2', 'st-group', t('st.gate')), el('p', null, t(data.gate === 'approve' ? 'st.gate.approve' : 'st.gate.auto')), el('p', 'muted small', t('st.gate.how')));
  g.hidden = false;
}

async function api(method, body) {
  const r = await fetch('/api/settings', { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = `${data.login}?next=${encodeURIComponent(location.href)}`; throw new Error('login'); }
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  msg.textContent = ''; okMsg.textContent = '';
  const values = {};
  for (const [key, s] of Object.entries(schema)) {
    const i = form.elements[key];
    values[key] = s.type === 'bool' ? i.checked : s.type === 'int' ? Number(i.value) : i.value;
  }
  const b = form.querySelector('button'); b.disabled = true;
  try { render(await api('PUT', { values })); okMsg.textContent = t('st.saved'); } catch (err) { if (err.message !== 'login') msg.textContent = err.message; }
  b.disabled = false;
});

texts();
api('GET').then(render).catch(e => { if (e.message !== 'login') msg.textContent = e.message; });
