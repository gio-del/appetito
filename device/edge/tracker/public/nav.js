'use strict';
// Bottom bar of the tracker on phones (issue 587): one definition for every page, loaded by each .html.
// Board, Progetti, Automatico, Aiuto; the current page is aria-current="page". Hidden above 760 px by CSS.
// The «Automatico» state is read from /api/auto, the same source as the board's pill (app.js).
(() => {
  const PILL = { working: ['bot', 'al lavoro', 'live'], idle: ['moon', 'in attesa', 'calm'], empty: ['moon', 'niente in coda', 'ok'],
    paused: ['pause', 'in pausa', 'warn'], quota: ['gauge', 'quota', 'warn'], error: ['alert', 'errore', 'bad'], dirty: ['branch', 'modifiche', 'warn'],
    busy: ['user', 'repo in uso', 'info'], resume: ['half', 'riprende', 'info'] };
  const page = (location.pathname.split('/').pop() || 'index.html');
  const cur = { 'index.html': 'board', 'projects.html': 'projects', 'auto.html': 'auto' }[page];
  const el = (tag, attrs, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); n.append(...kids); return n; };

  function build() {
    if (document.getElementById('bnav')) return;
    const item = (key, href, ic, label) => {
      const a = el('a', { href, 'data-nav': key }, icon(ic), el('span', { class: 'tx' }, label));
      if (cur === key) a.setAttribute('aria-current', 'page');
      return a;
    };
    const nav = el('nav', { id: 'bnav', class: 'bnav', 'aria-label': 'Navigazione' },
      item('board', 'index.html', 'layers', 'Board'),
      item('projects', 'projects.html', 'folder', 'Progetti'),
      item('auto', 'auto.html', 'bot', 'Automatico'));
    const help = document.getElementById('help-btn');
    if (help) {
      const b = el('button', { type: 'button', 'data-nav': 'help' }, icon('help'), el('span', { class: 'tx' }, 'Aiuto'));
      b.addEventListener('click', e => { e.stopPropagation(); help.click(); });
      nav.append(b);
    } else nav.append(item('help', 'index.html#aiuto', 'help', 'Aiuto'));
    document.body.append(nav);
    if (cur !== "board") document.body.append(el("div", { class: "bnav-gap", "aria-hidden": "true" })); // the board pads its own columns
    document.body.classList.add('has-bnav');
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  }

  async function refresh() {
    let st;
    try { const r = await fetch('/api/auto', { credentials: 'same-origin' }); if (!r.ok) return; st = await r.json(); } catch { return; }
    const [ic, txt, tone] = st.pending ? ['hourglass', 'avvio richiesto', 'info'] : PILL[st.status?.code] || ['bot', 'automatico', ''];
    const state = st.status?.code === 'working' && st.status.current ? `#${st.status.current.id}` : txt;
    const a = document.querySelector('#bnav [data-nav=auto]');
    if (!a) return;
    a.className = tone;
    a.setAttribute('aria-label', `Automatico: ${state}`);
    a.replaceChildren(icon(ic), el('span', { class: 'tx' }, 'Automatico'), el('span', { class: 'stx' }, state));
  }

  function start() { if (typeof icon === 'function') build(); }
  if (typeof icon === 'function') start();
  else { const s = document.createElement('script'); s.src = 'icons.js'; s.onload = start; document.head.append(s); }
})();
