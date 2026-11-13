// "Strategia della coda" (issue 225): form over GET/PUT /api/queue-config. The preview is computed by the
// server with the same selector ops-auto uses (POST /api/queue-config/preview, config not saved).
'use strict';
const $ = id => document.getElementById(id);
const form = $('qs-form'), msg = $('qs-msg'), okMsg = $('qs-ok');
const STRAT = {
  rotation: ['Rotazione', 'Un turno a testa fra le fonti, nell’ordine di sempre.'],
  weighted: ['Rotazione pesata', 'Come la rotazione, ma una fonte con peso 3 prende 3 turni di fila.'],
  priority: ['Per priorità', 'Prima urgent, poi high, medium, senza priorità, low, su tutte le fonti; a parità, rotazione.'],
  focus: ['In evidenza', 'Prima tutto il lavoro di un progetto scelto, poi gli altri a rotazione.'],
};
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
let data = null, timer = 0, seq = 0;

function current() {
  const strategy = (form.querySelector('input[name=strategy]:checked') || {}).value || 'rotation';
  const sources = {};
  for (const s of data.sources) sources[s] = { weight: Number($('w-' + s).value), paused: $('p-' + s).checked };
  const f = form.querySelector('input[name=focus]:checked');
  return { strategy, urgent_first: $('qs-urgent').checked, focus: f ? f.value : '', sources };
}
function syncEnabled() {
  const st = (form.querySelector('input[name=strategy]:checked') || {}).value;
  for (const s of data.sources) { $('w-' + s).disabled = st !== 'weighted'; $('f-' + s).disabled = st !== 'focus'; }
}
function renderPreview(list, total) {
  const ol = $('qs-preview'); ol.replaceChildren();
  $('qs-total').textContent = total ? `(${total} in coda)` : '';
  if (!list.length) { ol.append(el('li', 'muted', 'Niente in coda')); return; }
  list.forEach((i, n) => {
    const li = el('li', n === 0 ? 'next' : '');
    li.append(el('b', null, i.id), el('span', 'qs-src', i.source), el('span', 'qs-t', i.title));
    ol.append(li);
  });
}
async function api(method, url, body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/?next=queue.html'; throw new Error('login'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
}
function preview() {
  clearTimeout(timer); okMsg.textContent = '';
  const mine = ++seq;
  timer = setTimeout(async () => {
    try {
      const d = await api('POST', '/api/queue-config/preview', { config: current() });
      if (mine === seq) { msg.textContent = ''; renderPreview(d.preview, d.total); }
    } catch (e) { if (mine === seq) msg.textContent = e.message; }
  }, 150);
}
function render(d) {
  data = d; const c = d.config;
  const box = $('qs-strategies'); box.replaceChildren();
  for (const k of d.strategies) {
    const l = el('label', 'qs-line'), i = el('input'); i.type = 'radio'; i.name = 'strategy'; i.value = k; i.checked = c.strategy === k;
    const t = el('span'); t.append(el('b', null, STRAT[k][0]), el('small', 'muted', STRAT[k][1]));
    l.append(i, t); box.append(l);
  }
  $('qs-urgent').checked = c.urgent_first;
  const sb = $('qs-sources'); sb.replaceChildren();
  for (const s of d.sources) {
    const cfg = c.sources[s] || { weight: 1, paused: false };
    const row = el('div', 'qs-src-row'); row.append(el('b', 'qs-name', s));
    const w = el('input'); w.type = 'number'; w.min = 1; w.max = 5; w.step = 1; w.value = cfg.weight; w.id = 'w-' + s; w.inputMode = 'numeric'; w.setAttribute('aria-label', `Peso di ${s}`);
    const wl = el('label', 'qs-mini'); wl.append('Peso ', w);
    const p = el('input'); p.type = 'checkbox'; p.checked = cfg.paused; p.id = 'p-' + s; p.setAttribute('aria-label', `Metti in pausa ${s}`);
    const pl = el('label', 'qs-mini'); pl.append(p, ' Pausa');
    const f = el('input'); f.type = 'radio'; f.name = 'focus'; f.value = s; f.id = 'f-' + s; f.checked = c.focus === s; f.setAttribute('aria-label', `Metti in evidenza ${s}`);
    const fl = el('label', 'qs-mini'); fl.append(f, ' In evidenza');
    row.append(wl, pl, fl); sb.append(row);
  }
  syncEnabled(); renderPreview(d.preview, d.total); form.hidden = false;
}
form.addEventListener('change', () => { syncEnabled(); preview(); });
form.addEventListener('input', preview);
form.addEventListener('submit', async e => {
  e.preventDefault(); msg.textContent = ''; okMsg.textContent = '';
  const b = form.querySelector('.st-actions button'); b.disabled = true;
  try { render(await api('PUT', '/api/queue-config', { config: current() })); okMsg.textContent = 'Salvato'; }
  catch (err) { msg.textContent = err.message; }
  b.disabled = false;
});
api('GET', '/api/queue-config').then(render).catch(e => { msg.textContent = e.message; });
