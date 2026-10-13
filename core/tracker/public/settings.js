// "Impostazioni": a form over the tracker's fixed settings schema (GET/PUT /api/settings).
// The server validates every value; this page only shows them. Same session as the board.
'use strict';
const form = document.getElementById('st-form');
const list = document.getElementById('st-list');
const msg = document.getElementById('st-msg');
const okMsg = document.getElementById('st-ok');
let schema = {};

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const shown = (s, v) => s.type === 'bool' ? (v ? 'sì' : 'no') : `${v}${s.unit === '%' ? '%' : s.unit === 'h' ? ':00' : s.unit ? ' ' + s.unit : ''}`;

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

function render(data) {
  schema = data.schema;
  list.replaceChildren();
  let group = null;
  for (const [key, s] of Object.entries(schema)) {
    if (s.group !== group) { group = s.group; list.append(el('h2', 'st-group', group)); }
    const row = el('div', 'pa-row st-row');
    const info = el('div', 'pa-info');
    const label = el('label', 'pa-name', s.label + (s.unit && s.unit !== 'h' ? ` (${s.unit})` : ''));
    label.htmlFor = 'st-' + key;
    info.append(label, el('div', 'muted small', s.desc));
    const extra = s.type === 'int' ? `da ${s.min} a ${s.max}, ` : '';
    info.append(el('div', 'muted small', `${extra}predefinito ${shown(s, s.default)}${data.set.includes(key) ? '' : ' (in uso)'}`));
    row.append(info, input(key, s, data.values[key]));
    list.append(row);
  }
  form.hidden = false;
}

async function load() {
  const r = await fetch('/api/settings', { credentials: 'same-origin' });
  if (r.status === 401) { location.href = '/?next=settings.html'; return; }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  render(await r.json());
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
  try {
    const r = await fetch('/api/settings', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = '/?next=settings.html'; return; }
    if (!r.ok) throw new Error(data.error || r.statusText);
    render(data);
    okMsg.textContent = 'Salvato';
  } catch (err) { msg.textContent = err.message; }
  b.disabled = false;
});

load().catch(e => { msg.textContent = e.message; });
