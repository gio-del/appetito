'use strict';
// "Sviluppo automatico" (issues 067, 068): live status of ops-auto from /api/auto
// (ops-auto-card's /var/lib/edge-status/ops-auto.json), polled every 5-15 s; "Avvia ora" and
// per-issue starts go through POST /api/auto/run. Icons always come with a word or can be
// tapped (data-tip → popover: phones have no hover), and the ? button opens a legend built
// from the same tables. No inline styles/scripts (CSP): DOM built here, positions via CSSOM.
// icon() and ICONS come from icons.js.

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'tip') el.dataset.tip = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const $ = s => document.querySelector(s);

// Tables: [word, icon, colour/tone, explanation]. The legend is generated from them.
const CATS = {
  read: ['Legge', 'read', 'Apre e legge file del repo (cat, sed, ls, jq…)'],
  search: ['Cerca', 'search', 'Cerca nei file (grep, find, issues-similar)'],
  edit: ['Modifica', 'edit', 'Scrive o cambia file'],
  run: ['Esegue', 'run', 'Lancia script o test (node, sh, hs-*)'],
  git: ['Git', 'branch', 'Guarda la storia del repo (git log, diff, status)'],
  commit: ['Commit', 'commit', 'Salva le modifiche in git'],
  deploy: ['Deploy', 'deploy', 'Applica le modifiche al server (device/edge/deploy)'],
  service: ['Servizi', 'service', 'Controlla o riavvia servizi (sv, ps…)'],
  net: ['Rete', 'net', 'Chiamate HTTP locali (curl)'],
  plan: ['Piano', 'plan', 'Aggiorna la sua lista di passi'],
  web: ['Web', 'net', 'Legge pagine web'],
  other: ['Altro', 'other', 'Altri comandi'],
};
const OUTCOMES = {
  closed: ['Chiusa', 'done', 'ok', 'Issue completata e spostata in Fatte'],
  handed: ['A te', 'hand', 'warn', 'Serve un tuo passo (HITL) o una tua decisione'],
  partial: ['Parziale', 'half', 'info', 'Lavoro a metà: riprende al prossimo giro'],
  error: ['Errore', 'x', 'bad', 'Claude è uscito con un errore'],
  lost: ['Interrotta', 'lost', 'muted', 'Il giro si è fermato senza esito (riavvio, timeout)'],
  gaveup: ['A te (3 tentativi)', 'flag', 'bad', 'Non chiusa in 3 tentativi: passata a te'],
  running: ['In corso', 'spinner', 'live', 'Ci sta lavorando adesso'],
};
const STATES = {
  working: ['Al lavoro', 'bot', 'live', 'Claude sta lavorando una issue'],
  idle: ['In attesa', 'moon', 'calm', 'Aspetta il prossimo giro programmato (:07 e :37)'],
  empty: ['Niente in coda', 'done', 'ok', 'Nessuna issue da lavorare'],
  paused: ['In pausa', 'pause', 'warn', 'Messo in pausa dalla pagina Impostazioni'],
  quota: ['Fermo per la quota', 'gauge', 'warn', 'Quota settimanale oltre il limite impostato'],
  error: ['Errore all\'ultimo giro', 'alert', 'bad', 'L\'ultimo giro è finito con un errore (riprova al prossimo)'],
  dirty: ['Modifiche da committare', 'branch', 'warn', 'Nel repo ci sono modifiche non salvate: non parte finché non sono committate'],
  busy: ['Repo in uso', 'user', 'info', 'Qualcuno ha lavorato nel repo da poco: 30 minuti di quiete prima di un giro programmato'],
};
const SKIPS = {
  paused: ['In pausa', 'pause', 'warn'], quota: ['Quota esaurita', 'gauge', 'warn'], empty: ['Niente in coda', 'done', 'ok'],
  dirty: ['Modifiche da committare', 'branch', 'warn'], busy: ['Repo in uso', 'user', 'info'], notpickable: ['Issue non lavorabile', 'x', 'warn'],
  gaveup: ['Passata a te dopo 3 tentativi', 'flag', 'bad'], other: ['Saltato', 'skip', 'muted'],
};
const PRIO = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
const PRIO_NAME = { urgent: 'Urgente', high: 'Alta', medium: 'Media', low: 'Bassa', none: 'Nessuna' };

let D = null; // last /api/auto answer
let skew = 0; // server clock - browser clock (s)
const nowS = () => Date.now() / 1000 + skew;
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function dur(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${pad(Math.floor(s % 3600 / 60))}m`;
  return `${Math.floor(s / 86400)}g ${Math.floor(s % 86400 / 3600)}h`;
}
const ago = t => t ? dur(nowS() - t) + ' fa' : '';
const DAYS = ['dom', 'lun', 'mar', 'mer', 'giov', 'ven', 'sab'];
function dayHm(t) {
  const d = new Date(t * 1000), n = new Date(nowS() * 1000);
  if (d.toDateString() === n.toDateString()) return hm(t);
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `ieri ${hm(t)}`;
  return `${DAYS[d.getDay()]} ${pad(d.getDate())} ${hm(t)}`;
}

// Elements whose text follows the clock (countdowns, elapsed), refreshed every second.
let tickers = [];
function ticker(fn, cls) { const e = h('span', { class: cls || '' }); e.textContent = fn(); tickers.push([e, fn]); return e; }
setInterval(() => { for (const [e, fn] of tickers) e.textContent = fn(); }, 1000);

let toastT;
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- tap-to-explain popover and legend ----------

const tipBox = h('div', { class: 'tip-pop', role: 'tooltip', hidden: true });
document.body.append(tipBox);
let tipFor = null;
function hideTip() { tipBox.hidden = true; tipFor = null; }
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tip]');
  if (!t || t.closest('a, button')) { if (!e.target.closest('.tip-pop')) hideTip(); return; }
  e.preventDefault();
  if (tipFor === t) { hideTip(); return; }
  tipFor = t; tipBox.textContent = t.dataset.tip; tipBox.hidden = false;
  const r = t.getBoundingClientRect(), w = Math.min(280, innerWidth - 24);
  tipBox.style.maxWidth = w + 'px';
  const bw = tipBox.offsetWidth, bh = tipBox.offsetHeight;
  tipBox.style.left = Math.max(12, Math.min(innerWidth - bw - 12, r.left + r.width / 2 - bw / 2)) + 'px';
  tipBox.style.top = (r.top - bh - 8 > 8 ? r.top - bh - 8 : r.bottom + 8) + 'px';
});
addEventListener('scroll', hideTip, { passive: true });

function legend() {
  const row = (ic, tone, word, text, cls = '') => h('li', null, h('span', { class: `lg-ic ${tone} ${cls}` }, icon(ic)), h('div', null, h('b', null, word), h('span', null, text)));
  const sec = (title, rows) => h('section', null, h('h3', null, title), h('ul', null, rows));
  const sheet = h('div', { class: 'legend', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Legenda' },
    h('div', { class: 'legend-bg', onclick: () => sheet.remove() }),
    h('div', { class: 'legend-panel' },
      h('div', { class: 'legend-h' }, h('b', null, 'Cosa vogliono dire le icone'), h('button', { class: 'au-iconbtn', 'aria-label': 'Chiudi', onclick: () => sheet.remove() }, icon('x'))),
      h('p', { class: 'muted small' }, 'Tocca qualunque icona della pagina per la sua spiegazione.'),
      sec('Stato', Object.values(STATES).map(([w, ic, tone, t]) => row(ic, tone, w, t))),
      sec('Esito di una issue', Object.values(OUTCOMES).map(([w, ic, tone, t]) => row(ic, tone, w, t))),
      sec('Azioni di Claude', Object.entries(CATS).filter(([k]) => k !== 'web').map(([k, [w, ic, t]]) => row(ic, '', w, t, 'c-' + k))),
      sec('Giri', [row('calendar', 'calm', 'Programmato', 'Partito da solo (:07 e :37)'), row('hand', 'warn', 'Manuale', 'Avviato da te con Avvia ora o ▶'),
        row('skip', 'muted', 'Saltato', 'Il giro è partito ma non ha lavorato (motivo accanto)')]),
      sec('Coda', [row('wrench', 'bad', 'Errore rilevato', 'Issue aperta dal controllo automatico: viene prima'), row('zap', 'warn', 'Da fare', 'Issue in Da fare / In corso'),
        h('li', null, h('span', { class: 'lg-ic' }, prioBars('high')), h('div', null, h('b', null, 'Priorità'), h('span', null, '4 tacche = urgente, nessuna = senza priorità')))])));
  document.body.append(sheet);
}

// ---------- pieces ----------

// SVG ring: fraction 0..1 of a circle.
const SVGNS_ = 'http://www.w3.org/2000/svg';
function ring(frac, tone) {
  const s = document.createElementNS(SVGNS_, 'svg');
  s.setAttribute('viewBox', '0 0 100 100'); s.setAttribute('class', 'ring ' + tone);
  const C = 2 * Math.PI * 46;
  const mk = a => { const e = document.createElementNS(SVGNS_, 'circle'); for (const k in a) e.setAttribute(k, a[k]); s.append(e); };
  mk({ cx: 50, cy: 50, r: 46, class: 'ring-bg' });
  const f = Math.max(0, Math.min(1, frac || 0));
  mk({ cx: 50, cy: 50, r: 46, class: 'ring-fg', 'stroke-dasharray': `${f * C} ${C}`, transform: 'rotate(-90 50 50)' });
  return s;
}

async function api(method, url, body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/?next=auto.html'; throw new Error('login'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

async function start(issue, btn) {
  if (btn) btn.disabled = true;
  try {
    await api('POST', '/api/auto/run', issue ? { issue } : {});
    toast(issue ? `Richiesta inviata: #${issue} parte entro un minuto` : 'Richiesta inviata: parte entro un minuto');
    await load();
  } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
}

// Why the start button can't be used now (null = it can).
function blocker(st) {
  if (D.pending) return ['hourglass', 'Richiesta inviata, parte entro un minuto'];
  if (!st) return ['alert', 'Stato non disponibile'];
  if (st.code === 'working') return ['bot', 'Già al lavoro'];
  if (st.repo && st.repo.dirty) return ['branch', 'Modifiche da committare nel repo'];
  if (st.gates && st.gates.quotaUntil) return ['gauge', 'Quota settimanale esaurita'];
  if (!st.queueTotal) return ['done', 'Niente in coda'];
  return null;
}

// icCls animates the icon only (issue 069: a class on the badge spun the label too)
const badge = (ic, word, tone, tip, icCls = '') => h('span', { class: `bdg ${tone}`, tip }, icon(ic, icCls), h('span', null, word));
const outcomeBadge = o => { const [w, ic, tone, t] = OUTCOMES[o] || OUTCOMES.lost; return badge(ic, w, tone, t, o === 'running' ? 'spin' : ''); };
function stat(ic, value, caption, tip, tone = '') {
  return h('div', { class: 'stat ' + tone, tip }, h('div', { class: 'stat-v' }, icon(ic), value), h('div', { class: 'stat-c' }, caption));
}
function prioBars(p) {
  const n = PRIO[p] || 0;
  return h('span', { class: 'prio p-' + p, tip: 'Priorità: ' + (PRIO_NAME[p] || p) }, [1, 2, 3, 4].map(i => h('span', { class: i <= n ? 'on' : '' })));
}
const issueLink = (id, title) => h('a', { class: 'ilink', href: '/#' + id }, h('span', { class: 'cur-id' }, '#' + id), title ? h('span', { class: 'ilink-t' }, title) : null);

// ---------- sections ----------

function renderHero(st) {
  const [label, ic, tone, explain] = STATES[st ? st.code : 'error'] || STATES.error;
  let frac = 0, center = null, line = explain;
  if (st && st.code === 'working' && st.current && st.current.start) {
    frac = (nowS() - st.current.start) / 3600;
    center = ticker(() => dur(nowS() - st.current.start), 'hero-time');
    line = `Sta lavorando #${st.current.id} · si ferma comunque dopo 60 minuti`;
  } else if (st && st.nextSlot) {
    frac = 1 - (st.nextSlot - nowS()) / 1800;
    center = ticker(() => st.nextSlot > nowS() ? dur(st.nextSlot - nowS()) : 'ora', 'hero-time');
  }
  const b = blocker(st);
  const btn = h('button', { class: 'au-start' + (b ? ' off' : ''), disabled: !!b, onclick: e => start(null, e.currentTarget) },
    icon(b ? b[0] : 'play', D.pending ? 'spin-slow' : ''), h('span', null, b ? b[1] : 'Avvia ora'));
  const chips = h('div', { class: 'hero-chips' });
  if (st) {
    if (st.code !== 'working') chips.append(badge('calendar', `Prossimo giro ${dayHm(st.nextSlot)}`, 'calm', 'Giro programmato: parte da solo alle :07 e alle :37'));
    if (st.code === 'busy' && st.repo.freeAt) chips.append(badge('user', `Repo libero alle ${hm(st.repo.freeAt)}`, 'info', STATES.busy[3]));
    if (st.code === 'error' && st.last) chips.append(badge('alert', st.last.text, 'bad', `Ultimo esito, ${st.last.when}`));
    if (st.request && st.request.handled) {
      const r = st.request, ok = r.result === 'started';
      chips.append(badge(ok ? 'hand' : 'x', ok ? `Avviato a mano ${ago(r.handled)}` : `Avvio rifiutato: ${r.reason}`, ok ? 'ok' : 'warn',
        `Ultima richiesta manuale${r.issue ? ' su #' + r.issue : ''}`));
    }
  }
  $('#au-hero').replaceChildren(
    h('div', { class: `orb ${tone}`, tip: explain }, h('div', { class: 'orb-ring' }, ring(frac, tone)), h('div', { class: 'orb-core' }, icon(ic, 'orb-ic'), center)),
    h('div', { class: `hero-label ${tone}` }, label), h('div', { class: 'hero-line muted' }, line), btn, chips);
}

function toolCounts(counts) {
  return h('div', { class: 'counts' }, Object.keys(CATS).filter(k => counts[k]).map(k => {
    const [w, ic, t] = CATS[k];
    return h('span', { class: `cnt c-${k}`, tip: t }, icon(ic), h('span', null, w), h('b', null, counts[k]));
  }));
}
function toolStrip(tools, live) {
  return h('div', { class: 'strip-box' },
    h('div', { class: 'cap' }, live ? 'Sequenza delle azioni, la più recente illuminata' : 'Sequenza delle azioni'),
    h('div', { class: 'strip' }, tools.map((t, i) => {
      const [w, ic, tt] = CATS[t] || CATS.other;
      return h('span', { class: `tk c-${t}` + (live && i === tools.length - 1 ? ' last' : ''), tip: `${w}: ${tt}` }, icon(ic));
    })));
}
function todoView(todo) {
  if (!todo) return null;
  return h('div', { class: 'todo-box' },
    h('div', { class: 'cap' }, `Passi che Claude si è dato: ${todo.done} fatti su ${todo.total}`),
    h('div', { class: 'segbar' }, todo.items.map(it => h('span', { class: 'seg ' + it.s }))),
    h('ul', { class: 'todo' }, todo.items.map(it => h('li', { class: it.s },
      icon(it.s === 'done' ? 'check' : it.s === 'active' ? 'spinner' : 'circle', it.s === 'active' ? 'spin' : ''), h('span', null, it.t)))));
}

function renderCurrent(st) {
  const box = $('#au-current');
  const c = st && st.current;
  const lr = st && !c && st.lastRun && st.lastRun.total ? st.lastRun : null;
  if (!c && !lr) { box.hidden = true; return; }
  box.hidden = false;
  if (c) {
    const L = c.live || { tools: [], counts: {}, total: 0 };
    box.replaceChildren(
      h('div', { class: 'sec-h' }, icon('activity'), h('span', null, 'Adesso')),
      issueLink(c.id, c.title),
      h('div', { class: 'stats' },
        stat('timer', c.start ? ticker(() => dur(nowS() - c.start)) : '—', 'tempo', 'Da quanto lavora questa issue (massimo 60 minuti)'),
        stat('activity', String(L.total), 'azioni', 'Azioni eseguite finora'),
        stat('clock', L.lastAt ? ticker(() => ago(L.lastAt)) : '—', 'ultima azione', 'Quando ha fatto l\'ultima cosa'),
        stat('turns', `${c.attempt || 1}/3`, 'tentativo', 'Dopo 3 tentativi senza chiuderla la issue passa a te', (c.attempt || 1) > 1 ? 'warn' : ''),
        L.thinking ? stat('brain', String(L.thinking), 'ragionamenti', 'Momenti in cui ha ragionato prima di agire') : null,
        c.manual ? stat('hand', 'sì', 'manuale', 'Avviato da te', 'warn') : stat('calendar', 'no', 'manuale', 'Giro programmato')),
      todoView(L.todo), toolCounts(L.counts), toolStrip(L.tools, true));
  } else {
    box.replaceChildren(h('div', { class: 'sec-h' }, icon('activity'), h('span', null, 'Ultima issue lavorata: cosa ha fatto')),
      toolCounts(lr.counts), toolStrip(lr.tools, false));
  }
}

function limitBar(title, w, max, tip) {
  const u = w ? w.util : null;
  const tone = u == null ? 'muted' : max != null && u >= max ? 'bad' : max != null && u >= max * 0.8 ? 'warn' : u >= 90 ? 'warn' : 'ok';
  const fill = h('span', { class: 'lim-fill' }); fill.style.width = Math.min(100, u || 0) + '%';
  const track = h('div', { class: 'lim-track' }, fill);
  if (max != null) { const mk = h('span', { class: 'lim-max' }); mk.style.left = max + '%'; track.append(mk); }
  return h('div', { class: `lim ${tone}`, tip },
    h('div', { class: 'lim-h' }, h('span', null, title), h('b', null, u != null ? u + '%' : '—')),
    track,
    h('div', { class: 'lim-sub muted' }, max != null ? `limite ${max}%` : '', w && w.reset ? h('span', null, icon('history'), `si azzera ${dayHm(w.reset)}`) : null));
}
function tile(ic, title, value, tone, tip, n) {
  return h('div', { class: `tile ${tone}`, tip }, h('div', { class: 'tile-ic' }, icon(ic), n != null ? h('b', { class: 'tile-n' }, n) : null),
    h('div', { class: 'tile-t' }, title), h('div', { class: 'tile-v' }, value));
}

function renderGates(st) {
  if (!st) { $('#au-gates').replaceChildren(); $('#au-limits').replaceChildren(); return; }
  const g = st.gates || {}, c = st.counts || {}, inUse = st.repo.freeAt > nowS();
  $('#au-gates').replaceChildren(
    tile(g.paused ? 'pause' : 'play', 'Automatico', g.paused ? 'In pausa' : 'Attivo', g.paused ? 'warn' : 'ok',
      g.paused ? 'In pausa dalla pagina Impostazioni: i giri programmati non lavorano (Avvia ora sì)' : 'I giri programmati lavorano'),
    tile(st.repo.dirty ? 'branch' : inUse ? 'lock' : 'unlock', 'Repo', st.repo.dirty ? 'Modifiche' : inUse ? `In uso fino ${hm(st.repo.freeAt)}` : 'Libero',
      st.repo.dirty ? 'warn' : inUse ? 'info' : 'ok', st.repo.dirty ? STATES.dirty[3] : inUse ? STATES.busy[3] : 'Nessuno ci sta lavorando: il prossimo giro può partire'),
    tile('layers', 'Per giro', `fino a ${g.perRun} issue`, 'info', 'Quante issue al massimo in un giro (pagina Impostazioni)'),
    tile('bug', 'Errori', c.errorsBlocked ? `${c.errorsBlocked} aspettano te` : c.errors ? 'li sistema lui' : 'nessuno', c.errors ? 'bad' : 'ok',
      `Errori rilevati dal controllo automatico: ${c.errors} aperti, ${c.errorsBlocked} aspettano te`, c.errors),
    tile('sparkle', 'Da riordinare', c.lint ? 'issue con forma sbagliata' : 'tutto in ordine', c.lint ? 'info' : 'ok',
      'Issue scritte in un modo che il lavoro automatico non vede: le riordina lui', c.lint));
  $('#au-limits').replaceChildren(
    h('div', { class: 'sec-h' }, icon('gauge'), h('span', null, 'Consumo del piano Claude')),
    limitBar('Settimana', g.week, g.quotaMax, `Uso settimanale del piano Pro. Oltre il ${g.quotaMax}% (pagina Impostazioni) i giri si fermano`),
    limitBar('Ultime 5 ore', g.five, null, 'Limite delle 5 ore del piano Pro: se è pieno, il giro aspetta che si azzeri'));
}

function renderQueue(st) {
  const q = (st && st.queue) || [];
  const can = st && !blocker(st);
  $('#au-queue').replaceChildren(
    h('div', { class: 'sec-h' }, icon('inbox'), h('span', null, 'In coda'), h('b', { class: 'count-b' }, st ? st.queueTotal : 0)),
    q.length ? h('ol', { class: 'queue' }, q.map((i, n) => h('li', { class: n === 0 ? 'next' : '' },
      h('span', { class: 'q-kind ' + (i.monitor ? 'mon' : 'todo'), tip: i.monitor ? 'Errore rilevato: viene lavorato per primo' : 'Da fare' }, icon(i.monitor ? 'wrench' : 'zap')),
      prioBars(i.priority),
      h('div', { class: 'q-main' }, issueLink(i.id, i.title), n === 0 ? h('span', { class: 'q-next' }, 'la prossima') : null),
      h('button', { class: 'q-go', disabled: !can, 'aria-label': `Lavora subito #${i.id}`, title: can ? `Lavora subito #${i.id}` : (blocker(st) || [, ''])[1],
        onclick: e => start(i.id, e.currentTarget) }, icon('play'), h('span', null, 'Avvia')))))
      : h('div', { class: 'empty-row' }, icon('done'), h('span', null, 'Niente in coda')));
}

function issueRow(r) {
  return h('div', { class: 'irow' },
    outcomeBadge(r.outcome),
    h('div', { class: 'irow-main' }, issueLink(r.id, r.title),
      h('div', { class: 'meta' },
        r.end ? h('span', { tip: 'Durata' }, icon('timer'), dur(r.end - r.start)) : null,
        r.turns != null ? h('span', { tip: 'Passi di Claude (turni)' }, icon('turns'), `${r.turns} passi`) : null,
        r.cost != null ? h('span', { tip: 'Costo equivalente API in dollari: col piano Pro non è addebitato' }, icon('cost'), r.cost.toFixed(2)) : null,
        r.denied ? h('span', { class: 'den', tip: 'Azioni bloccate dal controllo di sicurezza: dettagli nei commenti della issue' }, icon('shield'), `${r.denied} bloccate`) : null,
        r.attempt > 1 ? h('span', { tip: 'Tentativo numero' }, icon('turns'), `tentativo ${r.attempt}`) : null)));
}

function renderRounds(st) {
  const rounds = ((st && st.rounds) || []).slice().reverse();
  // Keep what the owner opened or closed across refreshes; by default only the newest round is open.
  const prev = new Map([...document.querySelectorAll('details.round')].map(d => [d.dataset.start, d.open]));
  let opened = false;
  $('#au-history').replaceChildren(
    h('div', { class: 'sec-h' }, icon('history'), h('span', null, 'Giri recenti')),
    rounds.length ? h('div', { class: 'rounds' }, rounds.map(r => {
      const when = r.count > 1 ? `${dayHm(r.start)} → ${hm(r.end)}` : dayHm(r.start);
      if (r.request) {
        return h('div', { class: 'round skip warn' }, badge('hand', 'Manuale', 'warn', 'Avvio richiesto da te'), h('span', { class: 'r-when' }, when),
          h('span', { class: 'r-why' }, `rifiutato: ${r.text}`));
      }
      if (!r.issues.length) {
        const [w, ic, tone] = SKIPS[r.result] || SKIPS.other;
        return h('div', { class: `round skip ${tone}` }, badge(ic, 'Saltato', tone, `Il giro è partito ma non ha lavorato: ${w.toLowerCase()}`),
          h('span', { class: 'r-when' }, when), h('span', { class: 'r-why' }, w), r.count > 1 ? h('span', { class: 'r-count', tip: `${r.count} giri di fila saltati per lo stesso motivo` }, `×${r.count}`) : null);
      }
      const tally = {};
      for (const i of r.issues) tally[i.outcome] = (tally[i.outcome] || 0) + 1;
      const def = !opened; opened = true;
      const open = prev.has(String(r.start)) ? prev.get(String(r.start)) : def || r.live;
      return h('details', { class: 'round' + (r.live ? ' live' : ''), open, 'data-start': r.start },
        h('summary', null,
          r.manual ? badge('hand', 'Manuale', 'warn', 'Avviato da te') : badge('calendar', 'Programmato', 'calm', 'Partito da solo (:07 e :37)'),
          h('span', { class: 'r-when' }, when),
          h('span', { class: 'r-dur muted' }, r.live ? ticker(() => dur(nowS() - r.start)) : dur((r.end || r.start) - r.start)),
          h('span', { class: 'r-tally' }, Object.entries(tally).map(([o, n]) => {
            const [w, ic, tone] = OUTCOMES[o] || OUTCOMES.lost;
            return h('span', { class: `tl ${tone}`, tip: `${n} × ${w}` }, icon(ic, o === 'running' ? 'spin' : ''), n);
          })),
          h('span', { class: 'r-chev' }, icon('chevron'))),
        h('div', { class: 'round-body' }, r.issues.slice().reverse().map(issueRow)));
    })) : h('div', { class: 'empty-row' }, icon('moon'), h('span', null, 'Nessun giro registrato')));
}

function render() {
  tickers = []; hideTip();
  const st = D.status;
  renderHero(st); renderCurrent(st); renderGates(st); renderQueue(st); renderRounds(st);
  $('#au-live').replaceChildren(h('span', { class: 'pulse' + (st && st.code === 'working' ? ' on' : '') }),
    ticker(() => st ? `agg. ${ago(st.checked)}` : '—', 'small muted'));
}

let busy = false;
async function load() {
  if (busy) return; busy = true;
  try {
    D = await api('GET', '/api/auto');
    skew = D.now - Date.now() / 1000;
    $('#au-msg').textContent = '';
    // Don't rebuild under the finger: keep open rounds/popover stable unless something changed.
    const sig = JSON.stringify([D.status, D.pending]);
    if (sig !== load.sig) { load.sig = sig; render(); }
  } catch (e) { if (e.message !== 'login') $('#au-msg').textContent = e.message; }
  finally { busy = false; }
}

$('#au-back').append(icon('back'));
$('#au-help').append(icon('help'));
$('#au-help').addEventListener('click', legend);
load();
// Faster while something is moving (a run or a pending request), slower when idle.
setInterval(() => {
  if (document.hidden) return;
  const fast = D && (D.pending || (D.status && D.status.code === 'working'));
  if (fast || Date.now() % 15000 < 5000) load();
}, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
