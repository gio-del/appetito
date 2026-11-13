// "Cosa è successo" (issue 326): last 7 days by day. Every text is untrusted: textContent only.
'use strict';
const list = document.getElementById('rc-list');
const msg = document.getElementById('rc-msg');
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function block(day, title, items, fmt) {
  if (!items.length) return;
  day.append(el('h3', 'small', title));
  const ul = el('ul');
  for (const x of items) ul.append(el('li', null, fmt(x)));
  day.append(ul);
}
async function load() {
  const r = await fetch('/api/recent');
  if (r.status === 401) { location.href = '/'; return; }
  if (!r.ok) { msg.textContent = 'Errore nel caricamento'; return; }
  const { days } = await r.json();
  list.replaceChildren();
  if (!days.length) { list.append(el('p', 'muted', 'Niente di nuovo')); return; }
  for (const d of days) {
    const day = el('section', 'rc-day');
    day.append(el('h2', null, d.date));
    block(day, 'Issue chiuse', d.closed, i => `#${i.id} ${i.title}` + (i.costUsd == null ? '' : ` · $${i.costUsd.toFixed(2)}, ${i.runs} giri, ${i.attempts} tentativi`));
    block(day, 'Proposte scartate', d.rejected, i => `#${i.id} ${i.title}`);
    block(day, 'Deploy', d.deploys, x => `${x.time} ${x.ok ? 'riuscito' : 'fallito' + (x.phase ? ' (' + x.phase + (x.reason ? ': ' + x.reason : '') + ')' : '')}`);
    list.append(day);
  }
}
load().catch(() => { msg.textContent = 'Errore nel caricamento'; });
