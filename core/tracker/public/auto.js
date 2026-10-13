'use strict';
// Worker page: live status of the worker from /api/auto (the worker's status.json), polled every
// 5-15 s; "Start now" and per-issue starts go through POST /api/auto/run. Everything shown comes from
// agent-run's normalized transcript (step categories and statuses, never their content), so it looks
// the same with any backend. Icons always come with a word or can be tapped (data-tip → popover:
// phones have no hover), and the ? button opens a legend built from the same tables. No inline
// styles/scripts (CSP). icon() comes from icons.js, t() from i18n.js.

Object.assign(I18N.en, {
  'au.title': 'Worker', 'au.back': 'Back to the board', 'au.legend': 'Icon legend', 'au.legend.h': 'What the icons mean', 'au.legend.tap': 'Tap any icon on the page for its explanation.',
  'au.sec.state': 'State', 'au.sec.outcome': 'Outcome of an issue', 'au.sec.steps': 'Agent steps', 'au.sec.rounds': 'Rounds', 'au.sec.queue': 'Queue',
  'cat.read': ['Read', 'Opens and reads files'], 'cat.search': ['Search', 'Searches files and code'], 'cat.edit': ['Edit', 'Writes or changes files'],
  'cat.shell': ['Run', 'Runs a command or a test'], 'cat.web': ['Web', 'Reads a web page (allowlisted hosts only)'], 'cat.agent': ['Helper', 'Starts a helper agent'],
  'cat.plan': ['Plan', 'Updates its list of steps'], 'cat.other': ['Other', 'Other steps'],
  'oc.closed': ['Closed', 'Done, deployed and moved to Done'], 'oc.handed': ['Yours', 'Needs a step (HITL) or a decision from you'],
  'oc.partial': ['Partial', 'Half done: continues next round'], 'oc.error': ['Error', 'The agent stopped with an error'],
  'oc.lost': ['Interrupted', 'The round stopped without an outcome (reboot, timeout)'], 'oc.gaveup': ['Yours (3 attempts)', 'Not closed in 3 attempts: handed to you'],
  'oc.running': ['Running', 'Working on it now'], 'oc.waiting': ['Waits for your tap', 'The change touches the protections (or the merge gate is approve): see Changes'],
  'oc.failed': ['Not deployed', 'The deploy runner rejected it or rolled it back: a monitor issue says why'], 'oc.limit': ['Limit', 'A usage limit of the backend stopped the run: it retries after the reset'],
  'stt.working': ['Working', 'The agent is working on an issue'], 'stt.deploying': ['Deploying', 'The deploy runner is merging and checking the agent\'s change'],
  'stt.idle': ['Waiting', 'Waits for the next scheduled round (:07 and :37)'], 'stt.empty': ['Nothing queued', 'No issue to work on'],
  'stt.paused': ['Paused', 'Paused from the Settings page'], 'stt.quota': ['Usage limit', 'A usage window of the backend is over the limit you set'],
  'stt.budget': ['Daily budget', 'Today\'s budget (runs, tokens or cost) is used up'], 'stt.error': ['Error last round', 'The last round ended with an error (it retries next round)'],
  'sk.paused': 'Paused', 'sk.quota': 'Usage limit', 'sk.budget': 'Daily budget', 'sk.empty': 'Nothing queued', 'sk.notpickable': 'Issue not workable', 'sk.other': 'Skipped',
  'au.start': 'Start now', 'au.sent': 'Request sent: it starts within a minute', 'au.sent.issue': 'Request sent: #{0} starts within a minute',
  'au.b.pending': 'Request sent, starts within a minute', 'au.b.nostate': 'Status unavailable', 'au.b.working': 'Already working', 'au.b.quota': 'Usage limit reached', 'au.b.empty': 'Nothing queued',
  'au.working.on': 'Working on #{0} · stops anyway after 60 minutes', 'au.deploying.on': '#{0}: the deploy runner is checking the change',
  'au.next': 'Next round {0}', 'au.next.tip': 'Scheduled round: starts by itself at :07 and :37', 'au.manual.ok': 'Started by hand {0}', 'au.manual.no': 'Start refused: {0}', 'au.manual.last': 'Last manual request{0}',
  'au.now': 'Now', 'au.last': 'Last issue worked: what it did', 'au.seq': 'Sequence of steps', 'au.seq.live': 'Sequence of steps, latest lit up',
  'au.stat.time': ['time', 'How long it has been on this issue (60 minutes at most)'], 'au.stat.steps': ['steps', 'Steps so far'], 'au.stat.last': ['last step', 'When it did the last thing'],
  'au.stat.try': ['attempt', 'After 3 attempts without closing it the issue goes to you'], 'au.stat.denied': ['denied', 'Steps the permissions refused: details in the issue\'s comments'],
  'au.stat.manual': ['manual', 'Started by you'], 'au.stat.sched': ['scheduled', 'Scheduled round'], 'au.yes': 'yes', 'au.no': 'no',
  'au.t.auto': 'Worker', 'au.t.active': 'On', 'au.t.paused': 'Paused', 'au.t.paused.tip': 'Paused from Settings: scheduled rounds don\'t work (Start now does)', 'au.t.active.tip': 'Scheduled rounds work',
  'au.t.per': 'Per round', 'au.t.per.v': 'up to {0} issues', 'au.t.per.tip': 'How many issues at most in one round (Settings page)',
  'au.t.err': 'Failures', 'au.t.err.waiting': '{0} wait for you', 'au.t.err.self': 'it fixes them', 'au.t.err.none': 'none', 'au.t.err.tip': 'Failures the monitor found: {0} open, {1} wait for you',
  'au.t.lint': 'To reshape', 'au.t.lint.some': 'issues with a wrong shape', 'au.t.lint.none': 'all in order', 'au.t.lint.tip': 'Issues written so that the worker can\'t see their work: it reshapes them',
  'au.limits': 'Usage', 'au.win.five_hour': 'Last 5 hours', 'au.win.seven_day': 'Week', 'au.win.tip': 'Usage window reported by the backend. Over {0}% (Settings) the worker waits for the reset',
  'au.win.none': 'The backend reports no usage windows (e.g. a local model).', 'au.win.max': 'limit {0}%', 'au.win.reset': 'resets {0}',
  'au.day': 'Today', 'au.day.runs': 'runs', 'au.day.tokens': 'tokens', 'au.day.cost': 'cost', 'au.day.nolimit': 'no limit',
  'au.queue': 'Queued', 'au.queue.mon': 'Failure found by the monitor: worked first', 'au.queue.todo': 'To do', 'au.queue.next': 'next', 'au.queue.go': 'Start', 'au.queue.go.tip': 'Work on #{0} now', 'au.queue.empty': 'Nothing queued',
  'au.prio': 'Priority: {0}', 'au.prio.legend': ['Priority', '4 bars = urgent, none = no priority'],
  'au.rounds': 'Recent rounds', 'au.rounds.none': 'No rounds yet', 'au.r.manual': 'Manual', 'au.r.manual.tip': 'Started by you', 'au.r.sched': 'Scheduled', 'au.r.sched.tip': 'Started by itself (:07 and :37)',
  'au.r.refused': 'refused: {0}', 'au.r.skip': 'Skipped', 'au.r.skip.tip': 'The round started but did no work: {0}', 'au.r.count': '{0} rounds in a row skipped for the same reason',
  'au.m.dur': 'Duration', 'au.m.turns': 'Agent turns', 'au.m.turns.v': '{0} turns', 'au.m.tokens': 'Tokens used', 'au.m.cost': 'Cost reported by the backend (with a subscription plan it is not charged)',
  'au.m.denied': 'Steps refused by the permissions: details in the issue\'s comments', 'au.m.denied.v': '{0} denied', 'au.m.try': 'Attempt', 'au.m.try.v': 'attempt {0}', 'au.m.deploy': 'Deploy',
  'au.upd': 'upd. {0}', 'au.ago': '{0} ago', 'au.yesterday': 'yesterday {0}', 'au.d': 'd',
  'au.lg.rounds': [['Scheduled', 'Started by itself (:07 and :37)'], ['Manual', 'Started by you with Start now or ▶'], ['Skipped', 'The round started but did no work (reason next to it)']],
  'au.lg.queue': [['Failure found', 'Issue opened by the monitor: comes first'], ['To do', 'Issue in To do / In progress']],
});
Object.assign(I18N.it, {
  'au.title': 'Worker', 'au.back': 'Torna alla board', 'au.legend': 'Legenda delle icone', 'au.legend.h': 'Cosa vogliono dire le icone', 'au.legend.tap': 'Tocca qualunque icona della pagina per la sua spiegazione.',
  'au.sec.state': 'Stato', 'au.sec.outcome': 'Esito di una issue', 'au.sec.steps': 'Passi dell\'agente', 'au.sec.rounds': 'Giri', 'au.sec.queue': 'Coda',
  'cat.read': ['Legge', 'Apre e legge file'], 'cat.search': ['Cerca', 'Cerca nei file e nel codice'], 'cat.edit': ['Modifica', 'Scrive o cambia file'],
  'cat.shell': ['Esegue', 'Lancia un comando o un test'], 'cat.web': ['Web', 'Legge una pagina web (solo host consentiti)'], 'cat.agent': ['Aiutante', 'Avvia un agente aiutante'],
  'cat.plan': ['Piano', 'Aggiorna la sua lista di passi'], 'cat.other': ['Altro', 'Altri passi'],
  'oc.closed': ['Chiusa', 'Fatta, applicata e spostata in Fatte'], 'oc.handed': ['A te', 'Serve un tuo passo (HITL) o una tua decisione'],
  'oc.partial': ['Parziale', 'Lavoro a metà: riprende al prossimo giro'], 'oc.error': ['Errore', 'L\'agente si è fermato con un errore'],
  'oc.lost': ['Interrotta', 'Il giro si è fermato senza esito (riavvio, timeout)'], 'oc.gaveup': ['A te (3 tentativi)', 'Non chiusa in 3 tentativi: passata a te'],
  'oc.running': ['In corso', 'Ci sta lavorando adesso'], 'oc.waiting': ['Aspetta il tuo tocco', 'La modifica tocca le protezioni (o il merge gate è su approve): vedi Modifiche'],
  'oc.failed': ['Non applicata', 'Il deploy l\'ha rifiutata o annullata: una issue del monitor spiega perché'], 'oc.limit': ['Limite', 'Un limite d\'uso del backend ha fermato il giro: riprova dopo il reset'],
  'stt.working': ['Al lavoro', 'L\'agente sta lavorando una issue'], 'stt.deploying': ['Deploy', 'Il deploy sta unendo e controllando la modifica dell\'agente'],
  'stt.idle': ['In attesa', 'Aspetta il prossimo giro programmato (:07 e :37)'], 'stt.empty': ['Niente in coda', 'Nessuna issue da lavorare'],
  'stt.paused': ['In pausa', 'Messo in pausa dalla pagina Impostazioni'], 'stt.quota': ['Limite d\'uso', 'Una finestra d\'uso del backend è oltre il limite impostato'],
  'stt.budget': ['Budget del giorno', 'Il budget di oggi (esecuzioni, token o costo) è esaurito'], 'stt.error': ['Errore all\'ultimo giro', 'L\'ultimo giro è finito con un errore (riprova al prossimo)'],
  'sk.paused': 'In pausa', 'sk.quota': 'Limite d\'uso', 'sk.budget': 'Budget del giorno', 'sk.empty': 'Niente in coda', 'sk.notpickable': 'Issue non lavorabile', 'sk.other': 'Saltato',
  'au.start': 'Avvia ora', 'au.sent': 'Richiesta inviata: parte entro un minuto', 'au.sent.issue': 'Richiesta inviata: #{0} parte entro un minuto',
  'au.b.pending': 'Richiesta inviata, parte entro un minuto', 'au.b.nostate': 'Stato non disponibile', 'au.b.working': 'Già al lavoro', 'au.b.quota': 'Limite d\'uso raggiunto', 'au.b.empty': 'Niente in coda',
  'au.working.on': 'Sta lavorando #{0} · si ferma comunque dopo 60 minuti', 'au.deploying.on': '#{0}: il deploy sta controllando la modifica',
  'au.next': 'Prossimo giro {0}', 'au.next.tip': 'Giro programmato: parte da solo alle :07 e alle :37', 'au.manual.ok': 'Avviato a mano {0}', 'au.manual.no': 'Avvio rifiutato: {0}', 'au.manual.last': 'Ultima richiesta manuale{0}',
  'au.now': 'Adesso', 'au.last': 'Ultima issue lavorata: cosa ha fatto', 'au.seq': 'Sequenza dei passi', 'au.seq.live': 'Sequenza dei passi, il più recente illuminato',
  'au.stat.time': ['tempo', 'Da quanto lavora questa issue (massimo 60 minuti)'], 'au.stat.steps': ['passi', 'Passi eseguiti finora'], 'au.stat.last': ['ultimo passo', 'Quando ha fatto l\'ultima cosa'],
  'au.stat.try': ['tentativo', 'Dopo 3 tentativi senza chiuderla la issue passa a te'], 'au.stat.denied': ['bloccati', 'Passi rifiutati dai permessi: dettagli nei commenti della issue'],
  'au.stat.manual': ['manuale', 'Avviato da te'], 'au.stat.sched': ['programmato', 'Giro programmato'], 'au.yes': 'sì', 'au.no': 'no',
  'au.t.auto': 'Worker', 'au.t.active': 'Attivo', 'au.t.paused': 'In pausa', 'au.t.paused.tip': 'In pausa dalle Impostazioni: i giri programmati non lavorano (Avvia ora sì)', 'au.t.active.tip': 'I giri programmati lavorano',
  'au.t.per': 'Per giro', 'au.t.per.v': 'fino a {0} issue', 'au.t.per.tip': 'Quante issue al massimo in un giro (pagina Impostazioni)',
  'au.t.err': 'Errori', 'au.t.err.waiting': '{0} aspettano te', 'au.t.err.self': 'li sistema lui', 'au.t.err.none': 'nessuno', 'au.t.err.tip': 'Errori trovati dal monitor: {0} aperti, {1} aspettano te',
  'au.t.lint': 'Da riordinare', 'au.t.lint.some': 'issue con forma sbagliata', 'au.t.lint.none': 'tutto in ordine', 'au.t.lint.tip': 'Issue scritte in un modo che il worker non vede: le riordina lui',
  'au.limits': 'Consumo', 'au.win.five_hour': 'Ultime 5 ore', 'au.win.seven_day': 'Settimana', 'au.win.tip': 'Finestra d\'uso riportata dal backend. Oltre il {0}% (Impostazioni) il worker aspetta il reset',
  'au.win.none': 'Il backend non riporta finestre d\'uso (es. un modello locale).', 'au.win.max': 'limite {0}%', 'au.win.reset': 'si azzera {0}',
  'au.day': 'Oggi', 'au.day.runs': 'esecuzioni', 'au.day.tokens': 'token', 'au.day.cost': 'costo', 'au.day.nolimit': 'senza limite',
  'au.queue': 'In coda', 'au.queue.mon': 'Errore trovato dal monitor: viene lavorato per primo', 'au.queue.todo': 'Da fare', 'au.queue.next': 'la prossima', 'au.queue.go': 'Avvia', 'au.queue.go.tip': 'Lavora subito #{0}', 'au.queue.empty': 'Niente in coda',
  'au.prio': 'Priorità: {0}', 'au.prio.legend': ['Priorità', '4 tacche = urgente, nessuna = senza priorità'],
  'au.rounds': 'Giri recenti', 'au.rounds.none': 'Nessun giro registrato', 'au.r.manual': 'Manuale', 'au.r.manual.tip': 'Avviato da te', 'au.r.sched': 'Programmato', 'au.r.sched.tip': 'Partito da solo (:07 e :37)',
  'au.r.refused': 'rifiutato: {0}', 'au.r.skip': 'Saltato', 'au.r.skip.tip': 'Il giro è partito ma non ha lavorato: {0}', 'au.r.count': '{0} giri di fila saltati per lo stesso motivo',
  'au.m.dur': 'Durata', 'au.m.turns': 'Turni dell\'agente', 'au.m.turns.v': '{0} turni', 'au.m.tokens': 'Token usati', 'au.m.cost': 'Costo riportato dal backend (con un abbonamento non è addebitato)',
  'au.m.denied': 'Passi rifiutati dai permessi: dettagli nei commenti della issue', 'au.m.denied.v': '{0} bloccati', 'au.m.try': 'Tentativo', 'au.m.try.v': 'tentativo {0}', 'au.m.deploy': 'Deploy',
  'au.upd': 'agg. {0}', 'au.ago': '{0} fa', 'au.yesterday': 'ieri {0}', 'au.d': 'g',
  'au.lg.rounds': [['Programmato', 'Partito da solo (:07 e :37)'], ['Manuale', 'Avviato da te con Avvia ora o ▶'], ['Saltato', 'Il giro è partito ma non ha lavorato (motivo accanto)']],
  'au.lg.queue': [['Errore trovato', 'Issue aperta dal monitor: viene prima'], ['Da fare', 'Issue in Da fare / In corso']],
});

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

// Tables: key → [icon, tone]; words and explanations come from i18n ('cat.*', 'oc.*', 'stt.*').
const CATS = { read: 'read', search: 'search', edit: 'edit', shell: 'run', web: 'web', agent: 'bot', plan: 'plan', other: 'other' };
const OUTCOMES = { closed: ['done', 'ok'], handed: ['hand', 'warn'], partial: ['half', 'info'], error: ['x', 'bad'], lost: ['lost', 'muted'],
  gaveup: ['flag', 'bad'], running: ['spinner', 'live'], waiting: ['shield', 'warn'], failed: ['alert', 'bad'], limit: ['gauge', 'warn'] };
const STATES = { working: ['bot', 'live'], deploying: ['deploy', 'live'], idle: ['moon', 'calm'], empty: ['done', 'ok'], paused: ['pause', 'warn'],
  quota: ['gauge', 'warn'], budget: ['cost', 'warn'], error: ['alert', 'bad'] };
const SKIPS = { paused: ['pause', 'warn'], quota: ['gauge', 'warn'], budget: ['cost', 'warn'], empty: ['done', 'ok'], notpickable: ['x', 'warn'], other: ['skip', 'muted'] };
const PRIO = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
const word = (k) => t(k)[0], explain = k => t(k)[1];

let D = null; // last /api/auto answer
let skew = 0; // server clock - browser clock (s)
const nowS = () => Date.now() / 1000 + skew;
const pad = n => String(n).padStart(2, '0');
const hm = x => { const d = new Date(x * 1000); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function dur(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${pad(Math.floor(s % 3600 / 60))}m`;
  return `${Math.floor(s / 86400)}${t('au.d')} ${Math.floor(s % 86400 / 3600)}h`;
}
const ago = x => x ? t('au.ago', dur(nowS() - x)) : '';
function dayHm(x) {
  const d = new Date(x * 1000), n = new Date(nowS() * 1000);
  if (d.toDateString() === n.toDateString()) return hm(x);
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return t('au.yesterday', hm(x));
  return `${d.toLocaleDateString(LOCALE(), { weekday: 'short' })} ${pad(d.getDate())} ${hm(x)}`;
}
const kTok = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0);

let tickers = [];
function ticker(fn, cls) { const e = h('span', { class: cls || '' }); e.textContent = fn(); tickers.push([e, fn]); return e; }
setInterval(() => { for (const [e, fn] of tickers) e.textContent = fn(); }, 1000);

let toastT;
function toast(msg, bad) {
  const x = $('#toast'); x.textContent = msg; x.className = 'toast' + (bad ? ' bad' : ''); x.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { x.hidden = true; }, 4000);
}

// ---------- tap-to-explain popover and legend ----------

const tipBox = h('div', { class: 'tip-pop', role: 'tooltip', hidden: true });
document.body.append(tipBox);
let tipFor = null;
function hideTip() { tipBox.hidden = true; tipFor = null; }
document.addEventListener('click', e => {
  const x = e.target.closest('[data-tip]');
  if (!x || x.closest('a, button')) { if (!e.target.closest('.tip-pop')) hideTip(); return; }
  e.preventDefault();
  if (tipFor === x) { hideTip(); return; }
  tipFor = x; tipBox.textContent = x.dataset.tip; tipBox.hidden = false;
  const r = x.getBoundingClientRect(), w = Math.min(280, innerWidth - 24);
  tipBox.style.maxWidth = w + 'px';
  const bw = tipBox.offsetWidth, bh = tipBox.offsetHeight;
  tipBox.style.left = Math.max(12, Math.min(innerWidth - bw - 12, r.left + r.width / 2 - bw / 2)) + 'px';
  tipBox.style.top = (r.top - bh - 8 > 8 ? r.top - bh - 8 : r.bottom + 8) + 'px';
});
addEventListener('scroll', hideTip, { passive: true });

function legend() {
  const row = (ic, tone, w, text, cls = '') => h('li', null, h('span', { class: `lg-ic ${tone} ${cls}` }, icon(ic)), h('div', null, h('b', null, w), h('span', null, text)));
  const sec = (title, rows) => h('section', null, h('h3', null, title), h('ul', null, rows));
  const [rs, rm, rk] = t('au.lg.rounds'), [qm, qt] = t('au.lg.queue');
  const sheet = h('div', { class: 'legend', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('au.legend') },
    h('div', { class: 'legend-bg', onclick: () => sheet.remove() }),
    h('div', { class: 'legend-panel' },
      h('div', { class: 'legend-h' }, h('b', null, t('au.legend.h')), h('button', { class: 'au-iconbtn', 'aria-label': t('close'), onclick: () => sheet.remove() }, icon('x'))),
      h('p', { class: 'muted small' }, t('au.legend.tap')),
      sec(t('au.sec.state'), Object.entries(STATES).map(([k, [ic, tone]]) => row(ic, tone, word('stt.' + k), explain('stt.' + k)))),
      sec(t('au.sec.outcome'), Object.entries(OUTCOMES).map(([k, [ic, tone]]) => row(ic, tone, word('oc.' + k), explain('oc.' + k)))),
      sec(t('au.sec.steps'), Object.entries(CATS).map(([k, ic]) => row(ic, '', word('cat.' + k), explain('cat.' + k), 'c-' + k))),
      sec(t('au.sec.rounds'), [row('calendar', 'calm', ...rs), row('hand', 'warn', ...rm), row('skip', 'muted', ...rk)]),
      sec(t('au.sec.queue'), [row('wrench', 'bad', ...qm), row('zap', 'warn', ...qt),
        h('li', null, h('span', { class: 'lg-ic' }, prioBars('high')), h('div', null, h('b', null, t('au.prio.legend')[0]), h('span', null, t('au.prio.legend')[1])))])));
  document.body.append(sheet);
}

// ---------- pieces ----------

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
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = `${data.login}?next=${encodeURIComponent(location.href)}`; throw new Error('login'); }
  if (data.lang) setLang(data.lang);
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

async function start(issue, btn) {
  if (btn) btn.disabled = true;
  try {
    await api('POST', '/api/auto/run', issue ? { issue } : {});
    toast(issue ? t('au.sent.issue', issue) : t('au.sent'));
    await load();
  } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
}

function blocker(st) {
  if (D.pending) return ['hourglass', t('au.b.pending')];
  if (!st) return null;
  if (st.code === 'working' || st.code === 'deploying') return ['bot', t('au.b.working')];
  if (st.gates && st.gates.quotaUntil) return ['gauge', t('au.b.quota')];
  if (!st.queueTotal) return ['done', t('au.b.empty')];
  return null;
}

const badge = (ic, w, tone, tip, icCls = '') => h('span', { class: `bdg ${tone}`, tip }, icon(ic, icCls), h('span', null, w));
const outcomeBadge = o => { const [ic, tone] = OUTCOMES[o] || OUTCOMES.lost; const k = 'oc.' + (OUTCOMES[o] ? o : 'lost'); return badge(ic, word(k), tone, explain(k), o === 'running' ? 'spin' : ''); };
function stat(ic, value, key, tone = '') {
  const [caption, tip] = t(key);
  return h('div', { class: 'stat ' + tone, tip }, h('div', { class: 'stat-v' }, icon(ic), value), h('div', { class: 'stat-c' }, caption));
}
function prioBars(p) {
  const n = PRIO[p] || 0;
  return h('span', { class: 'prio p-' + p, tip: t('au.prio', t('prio.' + p)) }, [1, 2, 3, 4].map(i => h('span', { class: i <= n ? 'on' : '' })));
}
const issueLink = (id, title) => h('a', { class: 'ilink', href: '/#' + id }, h('span', { class: 'cur-id' }, '#' + id), title ? h('span', { class: 'ilink-t' }, title) : null);

// ---------- sections ----------

function renderHero(st) {
  // No status yet (a fresh install, before the worker's first round): waiting, not an error.
  const code = !st ? 'idle' : STATES[st.code] ? st.code : 'error';
  const [ic, tone] = STATES[code];
  let frac = 0, center = null, line = explain('stt.' + code);
  if (st && st.current && st.current.start) {
    frac = (nowS() - st.current.start) / 3600;
    center = ticker(() => dur(nowS() - st.current.start), 'hero-time');
    line = t(st.code === 'deploying' ? 'au.deploying.on' : 'au.working.on', st.current.id);
  } else if (st && st.nextSlot) {
    frac = 1 - (st.nextSlot - nowS()) / 1800;
    center = ticker(() => st.nextSlot > nowS() ? dur(st.nextSlot - nowS()) : t('time.now'), 'hero-time');
  }
  if (code === 'quota' && st.gates.quotaWhy) line += ` (${st.gates.quotaWhy})`;
  if (code === 'budget' && st.gates.budget) line += ` (${st.gates.budget})`;
  const b = blocker(st);
  const btn = h('button', { class: 'au-start' + (b ? ' off' : ''), disabled: !!b, onclick: e => start(null, e.currentTarget) },
    icon(b ? b[0] : 'play', D.pending ? 'spin-slow' : ''), h('span', null, b ? b[1] : t('au.start')));
  const chips = h('div', { class: 'hero-chips' });
  if (st) {
    if (!st.current) chips.append(badge('calendar', t('au.next', dayHm(st.nextSlot)), 'calm', t('au.next.tip')));
    if (st.request && st.request.handled) {
      const r = st.request, ok = r.result === 'started';
      chips.append(badge(ok ? 'hand' : 'x', ok ? t('au.manual.ok', ago(r.handled)) : t('au.manual.no', r.reason), ok ? 'ok' : 'warn',
        t('au.manual.last', r.issue ? ' #' + r.issue : '')));
    }
  }
  $('#au-hero').replaceChildren(
    h('div', { class: `orb ${tone}`, tip: explain('stt.' + code) }, h('div', { class: 'orb-ring' }, ring(frac, tone)), h('div', { class: 'orb-core' }, icon(ic, 'orb-ic'), center)),
    h('div', { class: `hero-label ${tone}` }, word('stt.' + code)), h('div', { class: 'hero-line muted' }, line), btn, chips);
}

function toolCounts(counts) {
  return h('div', { class: 'counts' }, Object.keys(CATS).filter(k => counts[k]).map(k =>
    h('span', { class: `cnt c-${k}`, tip: explain('cat.' + k) }, icon(CATS[k]), h('span', null, word('cat.' + k)), h('b', null, counts[k]))));
}
function toolStrip(tools, live) {
  return h('div', { class: 'strip-box' },
    h('div', { class: 'cap' }, live ? t('au.seq.live') : t('au.seq')),
    h('div', { class: 'strip' }, tools.map((c, i) => {
      const k = CATS[c] ? c : 'other';
      return h('span', { class: `tk c-${k}` + (live && i === tools.length - 1 ? ' last' : ''), tip: `${word('cat.' + k)}: ${explain('cat.' + k)}` }, icon(CATS[k]));
    })));
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
      h('div', { class: 'sec-h' }, icon('activity'), h('span', null, t('au.now'))),
      issueLink(c.id, c.title),
      h('div', { class: 'stats' },
        stat('timer', c.start ? ticker(() => dur(nowS() - c.start)) : '—', 'au.stat.time'),
        stat('activity', String(L.total), 'au.stat.steps'),
        stat('clock', L.lastAt ? ticker(() => ago(L.lastAt)) : '—', 'au.stat.last'),
        stat('turns', `${c.attempt || 1}/3`, 'au.stat.try', (c.attempt || 1) > 1 ? 'warn' : ''),
        L.denied ? stat('shield', String(L.denied), 'au.stat.denied', 'warn') : null,
        c.manual ? stat('hand', t('au.yes'), 'au.stat.manual', 'warn') : stat('calendar', t('au.no'), 'au.stat.manual')),
      toolCounts(L.counts), toolStrip(L.tools, true));
  } else {
    box.replaceChildren(h('div', { class: 'sec-h' }, icon('activity'), h('span', null, t('au.last'))), toolCounts(lr.counts), toolStrip(lr.tools, false));
  }
}

function limitBar(title, w, max, tip) {
  const u = w ? w.util : null;
  const tone = w && w.rejected ? 'bad' : u == null ? 'muted' : max != null && u >= max ? 'bad' : max != null && u >= max * 0.8 ? 'warn' : 'ok';
  const fill = h('span', { class: 'lim-fill' }); fill.style.width = Math.min(100, u || (w && w.rejected ? 100 : 0)) + '%';
  const track = h('div', { class: 'lim-track' }, fill);
  if (max != null) { const mk = h('span', { class: 'lim-max' }); mk.style.left = Math.min(100, max) + '%'; track.append(mk); }
  return h('div', { class: `lim ${tone}`, tip },
    h('div', { class: 'lim-h' }, h('span', null, title), h('b', null, u != null ? u + '%' : w && w.rejected ? '100%' : '—')),
    track,
    h('div', { class: 'lim-sub muted' }, max != null ? t('au.win.max', max) : '', w && w.reset ? h('span', null, icon('history'), t('au.win.reset', dayHm(w.reset))) : null));
}
function tile(ic, title, value, tone, tip, n) {
  return h('div', { class: `tile ${tone}`, tip }, h('div', { class: 'tile-ic' }, icon(ic), n != null ? h('b', { class: 'tile-n' }, n) : null),
    h('div', { class: 'tile-t' }, title), h('div', { class: 'tile-v' }, value));
}
function dayRow(label, used, max, fmt) {
  return h('div', { class: 'day-row' }, h('span', null, label), h('b', null, fmt(used)), h('span', { class: 'muted' }, max ? '/ ' + fmt(max) : t('au.day.nolimit')));
}

function renderGates(st) {
  if (!st) { $('#au-gates').replaceChildren(); $('#au-limits').replaceChildren(); return; }
  const g = st.gates || {}, c = st.counts || {};
  $('#au-gates').replaceChildren(
    tile(g.paused ? 'pause' : 'play', t('au.t.auto'), g.paused ? t('au.t.paused') : t('au.t.active'), g.paused ? 'warn' : 'ok', g.paused ? t('au.t.paused.tip') : t('au.t.active.tip')),
    tile('layers', t('au.t.per'), t('au.t.per.v', g.perRun), 'info', t('au.t.per.tip')),
    tile('bug', t('au.t.err'), c.errorsBlocked ? t('au.t.err.waiting', c.errorsBlocked) : c.errors ? t('au.t.err.self') : t('au.t.err.none'), c.errors ? 'bad' : 'ok',
      t('au.t.err.tip', c.errors, c.errorsBlocked), c.errors),
    tile('sparkle', t('au.t.lint'), c.lint ? t('au.t.lint.some') : t('au.t.lint.none'), c.lint ? 'info' : 'ok', t('au.t.lint.tip'), c.lint));
  const wins = g.windows || [];
  const d = g.day || {};
  $('#au-limits').replaceChildren(
    h('div', { class: 'sec-h' }, icon('gauge'), h('span', null, t('au.limits'))),
    wins.length ? wins.map(w => limitBar(I18N[LANG]['au.win.' + w.name] || I18N.en['au.win.' + w.name] || w.name.replace(/_/g, ' '), w, g.quotaMax, t('au.win.tip', g.quotaMax)))
      : h('p', { class: 'muted small' }, t('au.win.none')),
    h('div', { class: 'day' }, h('div', { class: 'cap' }, t('au.day')),
      dayRow(t('au.day.runs'), d.runs || 0, g.runsMax, String),
      dayRow(t('au.day.tokens'), d.tokens || 0, g.ktokMax ? g.ktokMax * 1000 : 0, kTok),
      dayRow(t('au.day.cost'), d.cost || 0, g.costMax, v => '$' + Number(v).toFixed(2))));
}

function renderQueue(st) {
  const q = (st && st.queue) || [];
  const can = st && !blocker(st);
  $('#au-queue').replaceChildren(
    h('div', { class: 'sec-h' }, icon('inbox'), h('span', null, t('au.queue')), h('b', { class: 'count-b' }, st ? st.queueTotal : 0)),
    q.length ? h('ol', { class: 'queue' }, q.map((i, n) => h('li', { class: n === 0 ? 'next' : '' },
      h('span', { class: 'q-kind ' + (i.monitor ? 'mon' : 'todo'), tip: i.monitor ? t('au.queue.mon') : t('au.queue.todo') }, icon(i.monitor ? 'wrench' : 'zap')),
      prioBars(i.priority),
      h('div', { class: 'q-main' }, issueLink(i.id, i.title), n === 0 ? h('span', { class: 'q-next' }, t('au.queue.next')) : null),
      h('button', { class: 'q-go', disabled: !can, 'aria-label': t('au.queue.go.tip', i.id), title: can ? t('au.queue.go.tip', i.id) : (blocker(st) || [, ''])[1],
        onclick: e => start(i.id, e.currentTarget) }, icon('play'), h('span', null, t('au.queue.go'))))))
      : h('div', { class: 'empty-row' }, icon('done'), h('span', null, t('au.queue.empty'))));
}

function issueRow(r) {
  return h('div', { class: 'irow' },
    outcomeBadge(r.outcome),
    h('div', { class: 'irow-main' }, issueLink(r.id, r.title),
      h('div', { class: 'meta' },
        r.end ? h('span', { tip: t('au.m.dur') }, icon('timer'), dur(r.end - r.start)) : null,
        r.turns != null ? h('span', { tip: t('au.m.turns') }, icon('turns'), t('au.m.turns.v', r.turns)) : null,
        r.tokens ? h('span', { tip: t('au.m.tokens') }, icon('activity'), kTok(r.tokens)) : null,
        r.cost ? h('span', { tip: t('au.m.cost') }, icon('cost'), r.cost.toFixed(2)) : null,
        r.denied ? h('span', { class: 'den', tip: t('au.m.denied') }, icon('shield'), t('au.m.denied.v', r.denied)) : null,
        r.deploy ? h('span', { tip: t('au.m.deploy') + (r.deployReason ? ': ' + r.deployReason : '') }, icon('deploy'), t('branch.' + r.deploy)) : null,
        r.attempt > 1 ? h('span', { tip: t('au.m.try') }, icon('turns'), t('au.m.try.v', r.attempt)) : null)));
}

function skipOf(result) {
  const m = /^skip:([a-z]+)/.exec(result || '');
  return m && SKIPS[m[1]] ? m[1] : 'other';
}
function renderRounds(st) {
  const rounds = ((st && st.rounds) || []).slice().reverse();
  const prev = new Map([...document.querySelectorAll('details.round')].map(d => [d.dataset.start, d.open]));
  let opened = false;
  $('#au-history').replaceChildren(
    h('div', { class: 'sec-h' }, icon('history'), h('span', null, t('au.rounds'))),
    rounds.length ? h('div', { class: 'rounds' }, rounds.map(r => {
      const when = r.count > 1 ? `${dayHm(r.start)} → ${hm(r.end)}` : dayHm(r.start);
      if (r.request) {
        return h('div', { class: 'round skip warn' }, badge('hand', t('au.r.manual'), 'warn', t('au.r.manual.tip')), h('span', { class: 'r-when' }, when),
          h('span', { class: 'r-why' }, t('au.r.refused', (r.result || '').replace(/^refused:/, ''))));
      }
      if (!r.issues.length) {
        const k = skipOf(r.result);
        const [ic, tone] = SKIPS[k];
        const w = t('sk.' + k);
        return h('div', { class: `round skip ${tone}` }, badge(ic, t('au.r.skip'), tone, t('au.r.skip.tip', w.toLowerCase())),
          h('span', { class: 'r-when' }, when), h('span', { class: 'r-why' }, w), r.count > 1 ? h('span', { class: 'r-count', tip: t('au.r.count', r.count) }, `×${r.count}`) : null);
      }
      const tally = {};
      for (const i of r.issues) tally[i.outcome] = (tally[i.outcome] || 0) + 1;
      const def = !opened; opened = true;
      const open = prev.has(String(r.start)) ? prev.get(String(r.start)) : def || r.live;
      return h('details', { class: 'round' + (r.live ? ' live' : ''), open, 'data-start': r.start },
        h('summary', null,
          r.manual ? badge('hand', t('au.r.manual'), 'warn', t('au.r.manual.tip')) : badge('calendar', t('au.r.sched'), 'calm', t('au.r.sched.tip')),
          h('span', { class: 'r-when' }, when),
          h('span', { class: 'r-dur muted' }, r.live ? ticker(() => dur(nowS() - r.start)) : dur((r.end || r.start) - r.start)),
          h('span', { class: 'r-tally' }, Object.entries(tally).map(([o, n]) => {
            const [ic, tone] = OUTCOMES[o] || OUTCOMES.lost;
            return h('span', { class: `tl ${tone}`, tip: `${n} × ${word('oc.' + (OUTCOMES[o] ? o : 'lost'))}` }, icon(ic, o === 'running' ? 'spin' : ''), n);
          })),
          h('span', { class: 'r-chev' }, icon('chevron'))),
        h('div', { class: 'round-body' }, r.issues.slice().reverse().map(issueRow)));
    })) : h('div', { class: 'empty-row' }, icon('moon'), h('span', null, t('au.rounds.none'))));
}

function texts() {
  document.title = t('au.title');
  $('#au-title').textContent = t('au.title');
  $('#au-back').setAttribute('aria-label', t('au.back'));
  $('#au-help').setAttribute('aria-label', t('au.legend')); $('#au-help').title = t('au.legend');
}
function render() {
  tickers = []; hideTip();
  texts();
  const st = D.status;
  renderHero(st); renderCurrent(st); renderGates(st); renderQueue(st); renderRounds(st);
  $('#au-live').replaceChildren(h('span', { class: 'pulse' + (st && (st.code === 'working' || st.code === 'deploying') ? ' on' : '') }),
    ticker(() => st ? t('au.upd', ago(st.checked)) : '—', 'small muted'));
}

let busy = false;
async function load() {
  if (busy) return; busy = true;
  try {
    D = await api('GET', '/api/auto');
    skew = D.now - Date.now() / 1000;
    $('#au-msg').textContent = '';
    const sig = JSON.stringify([D.status, D.pending, LANG]);
    if (sig !== load.sig) { load.sig = sig; render(); }
  } catch (e) { if (e.message !== 'login') $('#au-msg').textContent = e.message; }
  finally { busy = false; }
}

$('#au-back').append(icon('back'));
$('#au-help').append(icon('help'));
$('#au-help').addEventListener('click', legend);
texts();
load();
setInterval(() => {
  if (document.hidden) return;
  const fast = D && (D.pending || (D.status && (D.status.code === 'working' || D.status.code === 'deploying')));
  if (fast || Date.now() % 15000 < 5000) load();
}, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
