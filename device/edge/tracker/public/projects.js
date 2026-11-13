// "Issue dei Progetti" (issue 091): list of the GitHub issues mirrored by projects-issues-sync,
// filtered per Project. Ids are "<project>#<number>". Every text is untrusted: textContent only.
'use strict';
const list = document.getElementById('pj-list');
const msg = document.getElementById('pj-msg');
const sel = document.getElementById('pj-filter');
const closed = document.getElementById('pj-closed');
let data = { projects: {} };

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function labelChip(name) {
  let n = 0;
  for (const c of name) n = (n * 31 + c.codePointAt(0)) >>> 0;
  const e = el('span', 'lbl', name); e.style.setProperty('--c', `hsl(${n % 360} 65% 58%)`); return e;
}
const trustText = i => i.trusted ? (i.trust === 'author' ? 'tua' : 'assegnata da te') : 'non fidata';

// Drawer: same shell as the board's (issue 204); its content is replaced on every open, so there is never more than one panel.
const drawer = document.getElementById('drawer');
function closeDrawer(keepUrl) {
  drawer.hidden = true; document.getElementById('d-body').replaceChildren();
  if (!keepUrl && location.hash) history.replaceState(null, '', location.pathname + location.search);
}
// Deep link (issue 284): /projects.html#<project>-<number> opens that issue's drawer; unknown ids do nothing.
function openFromHash() {
  const m = /^#(.+)-(\d+)$/.exec(decodeURIComponent(location.hash));
  if (!m) return;
  const p = data.projects[m[1]];
  const i = p && p.issues.find(x => x.number === Number(m[2]));
  if (!i) return;
  if (sel.value && sel.value !== m[1]) sel.value = m[1];
  if (i.state === 'closed' && !closed.checked) closed.checked = true;
  render(true);
  openDrawer(m[1], i);
}
function openDrawer(name, i) {
  document.getElementById('d-id').textContent = i.id;
  const body = document.getElementById('d-body');
  const title = el('h2', 'd-title', i.title); title.id = 'd-title';
  const props = el('div', 'props');
  const row = (k, v) => { props.append(el('span', 'k', k)); props.append(typeof v === 'string' ? el('span', null, v) : v); };
  row('Progetto', name);
  row('Stato', i.state === 'closed' ? 'chiusa' : 'aperta');
  row('Fiducia', trustText(i));
  row('Autore', i.author || '-');
  const ls = el('span', 'label-edit'); i.labels.forEach(l => ls.append(labelChip(l))); row('Etichette', i.labels.length ? ls : '-');
  body.replaceChildren(title, props);
  if (i.url) { const a = el('a', null, 'Apri su GitHub'); a.href = i.url; a.rel = 'noopener noreferrer'; a.target = '_blank'; body.append(a); }
  body.append(el('div', 'section-h', 'Azioni'), panel(name, i));
  drawer.hidden = false;
  const h = '#' + name + '-' + i.number;
  if (decodeURIComponent(location.hash) !== h) history.replaceState(null, '', location.pathname + location.search + h);
}
drawer.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeDrawer(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });

function card(name, i) {
  const c = el('div', 'card' + (i.state === 'closed' ? ' closed' : ''));
  c.tabIndex = 0; c.setAttribute('role', 'button');
  const top = el('div', 'card-top');
  top.append(el('span', null, i.id), el('span', null, i.state === 'closed' ? 'chiusa' : 'aperta'));
  const meta = el('div', 'card-meta');
  meta.append(el('span', i.trusted ? 'pj-trust' : 'pj-trust no', trustText(i)), el('span', null, i.author || ''));
  i.labels.forEach(l => meta.append(labelChip(l)));
  c.append(top, el('div', 'card-title', i.title), meta);
  const open = () => openDrawer(name, i);
  c.addEventListener('click', open);
  c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return c;
}

function render(keepUrl) {
  closeDrawer(keepUrl === true);
  list.replaceChildren();
  const names = sel.value ? [sel.value] : Object.keys(data.projects);
  let n = 0;
  for (const name of names) {
    const p = data.projects[name];
    if (!p) continue;
    const shown = p.issues.filter(i => closed.checked || i.state !== 'closed');
    const sec = el('section', 'pj-sec');
    const head = el('div', 'pj-sec-h');
    head.append(el('span', null, name), el('span', 'count', String(p.issues.filter(i => i.state !== 'closed').length) + ' aperte'));
    if (p.repo) { const a = el('a', null, 'Repo'); a.href = 'https://github.com/' + p.repo; a.rel = 'noopener noreferrer'; a.target = '_blank'; head.append(a); }
    sec.append(head);
    if (p.error) sec.append(el('p', 'err', `${p.error}${p.stale ? ' (dati vecchi)' : ''}`));
    const cards = el('div', 'pj-cards');
    for (const i of shown) { n++; cards.append(card(name, i)); }
    if (!shown.length) cards.append(el('p', 'muted small', 'Nessuna issue.'));
    sec.append(cards);
    list.append(sec);
  }
  if (!n && !names.length) list.append(el('p', 'muted', 'Nessuna issue.'));
  msg.textContent = data.updated ? `Ultimo aggiornamento: ${data.updated}` : 'Nessun dato: la copia non è ancora girata.';
}

async function load() {
  const r = await fetch('/api/projects-issues', { credentials: 'same-origin' });
  if (r.status === 401) { location.href = '/?next=projects.html'; return; }
  data = await r.json();
  if (!sel.options.length) {
    const all = el('option', null, 'Tutti i Progetti'); all.value = ''; sel.append(all);
    for (const name of Object.keys(data.projects)) { const o = el('option', null, name); o.value = name; sel.append(o); }
  }
  render(true);
  openFromHash();
}
// Waiting for the server: a moving bar and the elapsed seconds so the page never looks frozen, and a
// message after 20 s without an answer (issue 332). Returns the function that stops the counter.
function waiting(out, what) {
  out.className = 'muted small'; out.textContent = '';
  const bar = el('span', 'pj-wait'); bar.setAttribute('aria-hidden', 'true');
  const txt = el('span', null, what);
  out.append(bar, txt);
  const t0 = Date.now();
  const iv = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    txt.textContent = s >= 20 ? `${what} Il server ci mette più del solito (${s} s), continuo ad aspettare…` : `${what} (${s} s)`;
  }, 1000);
  return () => clearInterval(iv);
}
// Changes go to GitHub through the server (issue 184): the tracker queues them, projects-issue-apply
// (a service, issue 332) re-reads the issue and writes; the answer comes back within a few seconds.
async function send(name, i, body, out, btns) {
  btns.forEach(b => { b.disabled = true; });
  let stop = waiting(out, 'Richiesta inviata, attendo il server…');
  const done = (ok, msg) => { stop(); out.className = ok ? 'pa-ok small' : 'err small'; out.textContent = msg; btns.forEach(b => { b.disabled = false; }); };
  try {
    const r = await fetch('/api/projects-issues/write', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: name, number: i.number, ...body }) });
    const j = await r.json();
    if (!r.ok) return done(false, j.error || 'errore');
    for (let n = 0; n < 260; n++) {
      await new Promise(res => setTimeout(res, 700));
      const s = await (await fetch(`/api/projects-issues/write/${j.id}`, { credentials: 'same-origin' })).json();
      if (s.done) { done(s.ok, s.msg); if (s.ok) setTimeout(load, 8000); return; }
    }
    done(false, 'nessuna risposta dal server, riprova');
  } catch { done(false, 'rete non raggiungibile'); }
}

// Rispondi (issue 307): for the owner's issues waiting on them (label needs-owner). «Rispondi» asks the server
// to read the issue now (projects-issue-apply is the only reader of the token): the open (HITL) steps and the
// last comment; then one box per step (or a single «Risposta»), one send = one comment + needs-owner removed.
function replyBox(name, i, out) {
  const box = el('div', 'proposal');
  box.append(el('p', null, 'Questa issue aspetta una tua risposta. Un solo invio: commento e issue di nuovo in coda.'));
  const open = el('button', 'btn primary', 'Rispondi'); open.type = 'button'; open.id = 'pj-reply';
  const acts = el('div', 'edit-actions'); acts.append(open); box.append(acts);
  let stopNow = () => {};
  const fail = msg => { stopNow(); out.className = 'err small'; out.textContent = msg; open.disabled = false; };
  open.addEventListener('click', async () => {
    open.disabled = true;
    stopNow = waiting(out, 'Leggo la issue su GitHub, attendo il server…');
    try {
      const r = await fetch('/api/projects-issues/write', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: name, number: i.number, action: 'read' }) });
      const j = await r.json();
      if (!r.ok) return fail(j.error || 'errore');
      for (let n = 0; n < 260; n++) {
        await new Promise(res => setTimeout(res, 700));
        const s = await (await fetch(`/api/projects-issues/write/${j.id}`, { credentials: 'same-origin' })).json();
        if (!s.done) continue;
        if (!s.ok) return fail(s.msg);
        stopNow(); out.textContent = '';
        return form(s);
      }
      fail('nessuna risposta dal server, riprova');
    } catch { fail('rete non raggiungibile'); }
  });
  function form(s) {
    const rows = (s.steps.length ? s.steps : ['']).map(text => {
      const kind = el('select'); kind.setAttribute('aria-label', 'Esito');
      for (const [v, t] of [['skip', 'Non ancora'], ['answer', 'Rispondi'], ...(text ? [['done', 'Fatto']] : [])]) { const o = el('option', null, t); o.value = v; kind.append(o); }
      if (!text) kind.value = 'answer';
      const ta = el('textarea'); ta.rows = 2; ta.maxLength = 2000; ta.placeholder = 'Risposta o nota (facoltativa se «Fatto»)'; ta.setAttribute('aria-label', 'Risposta');
      const e = el('div', 'reply-step'); e.append(el('div', 'reply-h', text || 'Risposta'), kind, ta);
      return { text, kind, ta, e };
    });
    const sendBtn = el('button', 'btn primary', 'Invia'); sendBtn.type = 'button'; sendBtn.id = 'pj-answer-send';
    const cancel = el('button', 'btn', 'Annulla'); cancel.type = 'button';
    const a2 = el('div', 'edit-actions'); a2.append(cancel, sendBtn);
    const f = el('div', 'pj-reply-form');
    if (s.last.text) { f.append(el('div', 'section-h', 'Ultimo commento' + (s.last.by ? ' di ' + s.last.by : '')), el('p', 'pj-last', s.last.text)); }
    f.append(...rows.map(r => r.e), a2);
    acts.replaceChildren(); box.append(f);
    cancel.addEventListener('click', () => { f.remove(); acts.append(open); open.disabled = false; });
    sendBtn.addEventListener('click', () => {
      const answers = rows.filter(r => r.kind.value !== 'skip').map(r => ({ text: r.text, kind: r.kind.value, note: r.ta.value.trim() }));
      if (!answers.length) { out.className = 'err small'; out.textContent = 'Scegli «Rispondi» o «Fatto» per almeno un passo'; return; }
      if (answers.some(a => a.kind === 'answer' && !a.note)) { out.className = 'err small'; out.textContent = 'Scrivi la risposta'; return; }
      send(name, i, { action: 'answer', answers }, out, [sendBtn, cancel]);
    });
  }
  return box;
}

function panel(name, i) {
  const box = el('div', 'pj-panel');
  const out = el('p', 'muted small'); out.setAttribute('role', 'status');
  if (i.state === 'open' && i.trusted && i.labels.includes('needs-owner')) box.append(replyBox(name, i, out));
  const ta = el('textarea'); ta.rows = 3; ta.maxLength = 4000; ta.placeholder = 'Commento'; ta.setAttribute('aria-label', 'Commento');
  const lab = el('input'); lab.type = 'text'; lab.maxLength = 50; lab.placeholder = 'Etichetta'; lab.setAttribute('aria-label', 'Etichetta');
  const mk = (text, id) => { const b = el('button', 'btn', text); b.type = 'button'; b.id = id; return b; };
  const bs = [mk('Commenta', 'pj-comment'), mk(i.state === 'closed' ? 'Riapri' : 'Chiudi', 'pj-state'), mk('Aggiungi etichetta', 'pj-ladd'), mk('Togli etichetta', 'pj-lrem')];
  bs[0].addEventListener('click', () => send(name, i, { action: 'comment', text: ta.value }, out, bs));
  bs[1].addEventListener('click', () => send(name, i, { action: i.state === 'closed' ? 'reopen' : 'close' }, out, bs));
  bs[2].addEventListener('click', () => send(name, i, { action: 'label-add', label: lab.value.trim() }, out, bs));
  bs[3].addEventListener('click', () => send(name, i, { action: 'label-remove', label: lab.value.trim() }, out, bs));
  const r1 = el('div', 'row'); r1.append(bs[0], bs[1]); const r2 = el('div', 'row'); r2.append(bs[2], bs[3]);
  box.append(ta, r1, lab, r2);
  // Manual start of ops-auto on this issue (issue 205): only open, trusted ones; the server says why not.
  if (i.state === 'open' && i.trusted) {
    const go = mk('Lavora su questa issue', 'pj-work'); go.classList.add('auto-go');
    go.addEventListener('click', async () => {
      go.disabled = true; out.className = 'muted small'; out.textContent = 'Richiesta inviata…';
      try {
        const r = await fetch('/api/auto/run', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ issue: i.id }) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) { location.href = '/?next=projects.html'; return; }
        if (!r.ok) { out.className = 'err small'; out.textContent = j.error || 'errore'; go.disabled = false; return; }
        out.className = 'pa-ok small'; out.textContent = `Avvio richiesto su ${i.id}: parte entro un minuto`;
      } catch { out.className = 'err small'; out.textContent = 'rete non raggiungibile'; go.disabled = false; }
    });
    const r3 = el('div', 'row'); r3.append(go); box.append(r3);
  }
  box.append(out);
  return box;
}

sel.addEventListener('change', () => render());
closed.addEventListener('change', () => render());
window.addEventListener('hashchange', () => { if (location.hash) openFromHash(); else closeDrawer(true); });
load();

// Rilasci (issues 208, 209): state of release-gate per Project with automatic releases. Texts come from a
// GitHub PR body (untrusted): textContent only. «Rimanda» asks release-gate to hold the announced release.
const rel = document.getElementById('rel-list');
const RULE_NAMES = { changelog: 'Novità', version: 'Versione', ci: 'Controlli (CI)', interval: 'Distanza dall\'ultima', soak: 'Prova sul server', monitor: 'Monitor', bugs: 'Bug aperti' };
const fmtDate = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }); };
const fmtDay = t => new Date(t * 1000).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
// "### Features" / "* text (link)" of release-please → sections with plain bullet lines
function changelogView(text) {
  const box = el('div', 'rel-log');
  let ul = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^#{1,2} /.test(line) || !line) continue;
    const h = /^### (.+)/.exec(line);
    if (h) { box.append(el('div', 'section-h', { Features: 'Novità', 'Bug Fixes': 'Correzioni', 'Performance Improvements': 'Prestazioni' }[h[1].trim()] || h[1].trim())); ul = null; continue; }
    const b = /^[*-] (.+)/.exec(line);
    if (!b) continue;
    if (!ul) { ul = el('ul'); box.append(ul); }
    ul.append(el('li', null, b[1].replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\s*\(\[[0-9a-f]{7}\]\([^)]*\)\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')));
  }
  if (!box.children.length) box.append(el('p', 'muted small', 'Nessuna novità elencata.'));
  return box;
}
function statusLine(p, now) {
  const hours = t => Math.max(0, Math.ceil((t - now) / 3600));
  if (p.paused) return ['Rilasci in pausa (impostazioni)', 'muted'];
  switch (p.status) {
    case 'announced': return [p.pending ? 'Richiesta di rinvio inviata: il server la applica entro un\'ora' : `Esce tra ${hours(p.release_at)} h (${fmtDay(p.release_at)})`, p.pending ? 'muted' : 'pa-ok'];
    case 'postponed': return [`Rimandata fino al ${fmtDay(p.postponed_until)}`, 'muted'];
    case 'serve-owner': return ['Major/1.0: decidi tu', 'err'];
    case 'waiting': return ['Aspetta', 'muted'];
    case 'released': return [`Rilasciata${p.released_at ? ' il ' + fmtDay(p.released_at) : ''}`, 'pa-ok'];
    default: return ['Nessuna Release PR aperta', 'muted'];
  }
}
function relCard(name, p, now) {
  const c = el('div', 'rel-card');
  const top = el('div', 'card-top');
  const [txt, cls] = statusLine(p, now);
  top.append(el('span', null, name + (p.version && p.status !== 'none' ? ' · v' + p.version : '')), el('span', null, p.stale ? 'dati vecchi' : ''));
  c.append(top, el('div', 'rel-status ' + cls, txt));
  if (p.last_tag) c.append(el('div', 'muted small', `Ultima release: ${p.last_tag}${p.last_at ? ' del ' + fmtDate(p.last_at) : ''}`));
  if (p.error) c.append(el('p', 'err small', p.error));
  if (p.note) c.append(el('p', 'muted small', p.note));
  if (p.status !== 'none' && p.status !== 'released') {
    c.append(changelogView(p.changelog));
    const bad = p.rules.filter(r => !r.ok);
    if (p.status === 'waiting' || bad.length) {
      const ul = el('ul', 'rel-rules');
      for (const r of (p.status === 'waiting' ? bad : [])) ul.append(el('li', null, `${RULE_NAMES[r.rule] || r.rule}: ${r.why}`));
      if (ul.children.length) c.append(el('div', 'section-h', 'Perché aspetta'), ul);
    }
    const acts = el('div', 'row');
    if (p.url) { const a = el('a', 'btn', 'Apri la PR'); a.href = p.url; a.rel = 'noopener noreferrer'; a.target = '_blank'; acts.append(a); }
    if (p.status === 'announced' && !p.paused) {
      const b = el('button', 'btn', 'Rimanda'); b.type = 'button'; b.id = 'rel-postpone-' + name; b.disabled = p.pending;
      const out = el('p', 'muted small'); out.setAttribute('role', 'status');
      b.addEventListener('click', async () => {
        if (b.disabled) return;
        b.disabled = true; out.className = 'muted small'; out.textContent = 'Richiesta inviata…';
        try {
          const r = await fetch('/api/releases/postpone', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: name }) });
          const j = await r.json().catch(() => ({}));
          if (r.status === 401) { location.href = '/?next=projects.html'; return; }
          if (!r.ok) { out.className = 'err small'; out.textContent = j.error || 'errore'; b.disabled = false; return; }
          out.className = 'pa-ok small'; out.textContent = 'Rimandata: il server la applica entro un\'ora, per 7 giorni o fino a nuove novità';
          setTimeout(loadReleases, 1500);
        } catch { out.className = 'err small'; out.textContent = 'rete non raggiungibile'; b.disabled = false; }
      });
      acts.append(b); c.append(acts, out);
    } else if (acts.children.length) c.append(acts);
  }
  return c;
}
async function loadReleases() {
  try {
    const r = await fetch('/api/releases', { credentials: 'same-origin' });
    if (!r.ok) return;
    const d = await r.json();
    const names = Object.keys(d.projects);
    rel.replaceChildren();
    if (!names.length) return;
    const sec = el('section', 'rel-sec');
    sec.append(el('div', 'pj-sec-h', 'Rilasci'));
    const cards = el('div', 'rel-cards');
    for (const n of names) cards.append(relCard(n, d.projects[n], d.now));
    sec.append(cards); rel.append(sec);
  } catch {}
}
loadReleases();

// PR da unire a mano (issue 349): green PRs the server does not merge (they touch .github/, dependencies, deploy). Texts are plain fields: textContent only.
async function loadPrsToMerge() {
  const box = document.getElementById('pr-list');
  try {
    const r = await fetch('/api/prs-to-merge', { credentials: 'same-origin' });
    if (!r.ok) return;
    const d = await r.json();
    box.replaceChildren();
    if (!d.prs.length) return;
    const sec = el('section', 'rel-sec');
    sec.append(el('div', 'pj-sec-h', 'PR da unire a mano'));
    const cards = el('div', 'rel-cards');
    for (const x of d.prs) {
      const c = el('div', 'rel-card');
      c.append(el('div', 'pj-sec-h', `${x.project} · PR #${x.pr}${x.title ? ' · ' + x.title : ''}`));
      c.append(el('p', 'muted small', 'CI verde, ma il server non la unisce: ' + (x.reason || 'tocca file sensibili') + (x.since ? ` (da ${fmtDay(x.since)})` : '')));
      if (x.url) { const a = el('a', 'btn', 'Apri la PR'); a.href = x.url; a.rel = 'noopener noreferrer'; a.target = '_blank'; c.append(a); }
      cards.append(c);
    }
    sec.append(cards); box.append(sec);
  } catch {}
}
loadPrsToMerge();
