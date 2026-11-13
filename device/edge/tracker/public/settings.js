// "Impostazioni": a form over the tracker's fixed settings schema (GET/PUT /api/settings).
// The server validates every value; this page only shows them. Same session as the board.
'use strict';
const form = document.getElementById('st-form');
const list = document.getElementById('st-list');
const msg = document.getElementById('st-msg');
const okMsg = document.getElementById('st-ok');
let schema = {};

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const shown = (s, v) => s.type === 'enum' ? (s.labels?.[v] ?? v) : s.type === 'bool' ? (v ? 'sì' : 'no') : `${v}${s.unit === '%' ? '%' : s.unit === 'h' ? ':00' : s.unit ? ' ' + s.unit : ''}`;

function input(key, s, v) {
  let i;
  if (s.type === 'bool') { i = el('input'); i.type = 'checkbox'; i.checked = v; }
  else if (s.type === 'enum') { i = el('select'); for (const o of s.values) i.append(new Option(s.labels?.[o] ?? o, o, false, o === v)); }
  else if (s.type === 'time') { i = el('input'); i.type = 'time'; i.value = v; }
  else if (s.type === 'text') { i = el('input'); i.type = 'text'; i.maxLength = 64; i.required = true; i.value = v; }
  else { i = el('input'); i.type = 'number'; i.min = s.min; i.max = s.max; i.step = 1; i.required = true; i.inputMode = 'numeric'; i.value = v; }
  i.id = 'st-' + key; i.name = key;
  return i;
}

let openHelp = null;
function closeHelp() {
  if (!openHelp) return;
  openHelp.panel.hidden = true; openHelp.btn.setAttribute('aria-expanded', 'false'); openHelp = null;
}
document.addEventListener('click', e => { if (openHelp && !e.target.closest('.st-help, .st-panel')) closeHelp(); });

function row(key, s, data) {
  const r = el('div', 'st-item');
  const row = el('div', 'pa-row st-row'); row.id = 'row-' + key;
  const info = el('div', 'pa-info');
  const head = el('div', 'st-head');
  const label = el('label', 'pa-name', s.label + (s.unit && s.unit !== 'h' ? ` (${s.unit})` : ''));
  label.htmlFor = 'st-' + key;
  head.append(label);
  if (s.level === 'advanced' && data.values[key] !== s.default) { const d = el('span', 'st-dot'); d.title = 'diverso dal predefinito'; d.setAttribute('role', 'img'); d.setAttribute('aria-label', 'diverso dal predefinito'); head.append(d); }
  const btn = el('button', 'st-help', '?'); btn.type = 'button'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-label', 'Spiegazione: ' + s.label);
  head.append(btn);
  info.append(head, el('div', 'muted small', s.hint));
  row.append(info, input(key, s, data.values[key]));
  const panel = el('div', 'st-panel muted small'); panel.hidden = true;
  const extra = s.type === 'int' ? `da ${s.min} a ${s.max}, ` : '';
  panel.append(el('div', null, s.desc), el('div', null, `${extra}predefinito ${shown(s, s.default)}${data.set.includes(key) ? '' : ' (in uso)'}`));
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const was = openHelp && openHelp.btn === btn;
    closeHelp();
    if (!was) { panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); openHelp = { btn, panel }; }
  });
  r.append(row, panel);
  return r;
}

function render(data) {
  schema = data.schema;
  const wasOpen = document.getElementById('st-adv')?.open;
  closeHelp();
  list.replaceChildren();
  const adv = Object.entries(schema).filter(([, s]) => s.level === 'advanced');
  const details = el('details', 'st-adv'); details.id = 'st-adv';
  details.append(el('summary', null, `Avanzate (${adv.length})`));
  const fill = (box, level) => {
    let group = null;
    for (const [key, s] of Object.entries(schema)) {
      if (s.level !== level) continue;
      if (s.group !== group) { group = s.group; box.append(el('h2', 'st-group', group)); }
      box.append(row(key, s, data));
    }
  };
  fill(list, 'essential');
  fill(details, 'advanced');
  list.append(details);
  const want = decodeURIComponent(location.hash.slice(1));
  if (wasOpen || (want && schema[want]?.level === 'advanced')) details.open = true;
  form.hidden = false;
  if (want) document.getElementById('row-' + want)?.scrollIntoView();
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
  const b = form.querySelector('.st-actions button'); b.disabled = true;
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
