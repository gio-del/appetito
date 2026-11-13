// "Attività programmate": jobs per category with their last result (jobs-status, issue 224).
// A category is open by itself only when it has an error or a late job (or when the URL names it: #backup).
'use strict';
const list = document.getElementById('jb-list');
const msg = document.getElementById('jb-msg');

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const pad = n => String(n).padStart(2, '0');
function when(t) {
  const d = new Date(t * 1000), now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? hm : `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hm}`;
}
const TXT = { ok: 'ok', error: 'errore', late: 'in ritardo', nodata: 'nessun dato' };

async function load() {
  const r = await fetch('/api/jobs', { credentials: 'same-origin' });
  if (r.status === 401) { location.href = '/?next=jobs.html'; return; }
  const { categories } = await r.json();
  list.replaceChildren();
  const keys = Object.keys(categories);
  if (!keys.length) list.append(el('p', 'muted', 'Nessun dato: il controllo non è ancora girato.'));
  for (const k of keys) {
    const c = categories[k];
    const d = el('details', 'jb-cat');
    d.id = k;
    d.open = c.problem || location.hash === `#${k}`;
    d.append(el('summary', c.problem ? 'jb-bad' : 'jb-good', `${c.name} · ${c.label}`));
    for (const j of c.jobs) {
      const row = el('div', 'jb-job');
      const head = el('div', 'jb-head');
      head.append(el('span', 'jb-title', j.title), el('span', `jb-st jb-${j.status}`, TXT[j.status] || j.status));
      row.append(head, el('div', 'muted small', j.when));
      if (j.t) row.append(el('div', 'muted small', `Ultimo giro ${when(j.t)}${j.rc ? ` · codice ${j.rc}` : ''}`));
      d.append(row);
    }
    list.append(d);
  }
}

load().catch(e => { msg.textContent = e.message; });
