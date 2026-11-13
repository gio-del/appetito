// "App dei Progetti" section of the settings page (issue 477): which Project apps are on, off for lack of use or
// "Sempre accesa", with the touch to turn one back on. GET/POST /api/apps; the server applies a request within a minute.
'use strict';
(() => {
  const box = document.getElementById('apps-list');
  const msg = document.getElementById('apps-msg');
  if (!box) return;
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const dm = d => d.slice(8, 10) + '/' + d.slice(5, 7);
  const FEAT = { proposte: 'Proposte giornaliere', domande: 'Risposte suggerite alle Domande', smistamento: 'Smistamento dell\'Inbox', cv: 'CV dalle richieste nel Vault' }; // features of issue 480
  let timer = null;
  async function load() {
    const r = await fetch('/api/apps');
    if (!r.ok) { msg.textContent = 'Non riesco a leggere le app.'; return; }
    const { apps } = await r.json();
    box.replaceChildren();
    for (const a of apps) {
      const row = el('div', 'pa-row'); row.dataset.app = a.app;
      const info = el('div', 'pa-info');
      info.append(el('div', 'pa-name', FEAT[a.app] || a.app), el('div', 'muted small', a.new ? 'nuova: spenta finché non la provi' : a.off ? `spenta perché non usata dal ${dm(a.off)}` : a.always ? 'sempre accesa' : 'accesa finché la usi'));
      const btns = el('div');
      if (a.off) btns.append(a.new ? button('Prova', a.app, 'trial') : button('Riaccendi', a.app, 'on'));
      else btns.append(a.always ? button('Togli sempre accesa', a.app, 'auto') : button('Sempre accesa', a.app, 'always'));
      row.append(info, btns); box.append(row);
    }
    if (!apps.length) box.append(el('p', 'muted small', 'Nessuna app di Progetto.'));
  }
  function button(label, app, action) {
    const b = el('button', 'btn', label); b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true; msg.textContent = '';
      const r = await fetch('/api/apps', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app, action }) });
      if (!r.ok) { msg.textContent = 'Richiesta rifiutata.'; b.disabled = false; return; }
      msg.textContent = 'Richiesta inviata: il server la applica entro un minuto.';
      clearInterval(timer); let n = 0;
      timer = setInterval(() => { load(); if (++n >= 20) clearInterval(timer); }, 5000);
    });
    return b;
  }
  load();
})();
