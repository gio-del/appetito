// "App del telefono": latest GitHub release vs the version marked as installed, with a
// "Ho aggiornato" button (marks the latest release as installed). Same session as the board.
'use strict';
const list = document.getElementById('pa-list');
const msg = document.getElementById('pa-msg');

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function day(d) { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(d || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }

async function load() {
  const r = await fetch('/api/phone-apps', { credentials: 'same-origin' });
  if (r.status === 401) { location.href = '/?next=phone-apps.html'; return; }
  const { apps } = await r.json();
  list.replaceChildren();
  const ids = Object.keys(apps);
  if (!ids.length) list.append(el('p', 'muted', 'Nessun dato: il controllo non è ancora girato.'));
  for (const id of ids) {
    const a = apps[id];
    const row = el('div', 'pa-row');
    const info = el('div', 'pa-info');
    info.append(el('div', 'pa-name', a.label));
    const ok = a.latest && a.latest === a.installed;
    info.append(el('div', ok ? 'pa-ok' : 'pa-new',
      !a.latest ? 'Ultima versione sconosciuta (controllo fallito)'
        : ok ? `Aggiornata: ${a.installed}`
        : `Disponibile ${a.latest}${a.date ? ' del ' + day(a.date) : ''} · installata ${a.installed}`));
    const link = el('a', 'small', 'Release su GitHub');
    link.href = `https://github.com/${a.repo}/releases/latest`; link.rel = 'noopener noreferrer'; link.target = '_blank';
    info.append(link);
    row.append(info);
    if (a.latest && !ok) {
      const b = el('button', 'btn primary', 'Ho aggiornato');
      b.addEventListener('click', () => mark(id, a.latest, b));
      row.append(b);
    }
    list.append(row);
  }
}

async function mark(id, version, b) {
  b.disabled = true; msg.textContent = '';
  try {
    const r = await fetch(`/api/phone-apps/${encodeURIComponent(id)}`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    const row = b.closest('.pa-row');
    row.querySelector('.pa-new').replaceWith(el('div', 'pa-ok', `Segnata come installata: ${version}`));
    b.remove();
  } catch (e) { msg.textContent = e.message; b.disabled = false; }
}

load().catch(e => { msg.textContent = e.message; });
