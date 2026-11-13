#!/usr/bin/env node
// Layout test of the tracker board (issue 151): starts server.js on a fixture repo, opens the board
// in headless Chromium (Debian package, driven over the DevTools protocol with Node's own WebSocket:
// no npm dependencies) at phone and desktop widths, fails if the filter bar or the top bar overlap
// or overflow (and, on phones, if the column tabs do not fit or the folded filters miscount: issue 155),
// and saves a screenshot of each case; then taps a card chip (popover, card closed: issue 154)
// and checks the drawer's "Non prima del" row (issue 153).
// Helpers for new tests (openDrawer, clickText, fill, issueFile) are defined in main(); see docs/services.md.
// Usage: node device/edge/tests/tracker-ui.js [SHOTS_DIR]   (default /tmp/tracker-ui)
// Exit 0 ok, 1 layout failures, 2 setup error, 77 Chromium not installed (the test is skipped).
'use strict';
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHOTS = path.resolve(process.argv[2] || '/tmp/tracker-ui');
const CHROME = ['chromium', 'chromium-browser', 'google-chrome'].find(b => {
  try { execFileSync('sh', ['-c', `command -v ${b}`], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!CHROME) { console.log('skip: chromium non installato (apt-get install chromium)'); process.exit(77); }

const CASES = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'phone-filtri-attivi', width: 390, height: 844, mobile: true, active: true },
  { name: 'phone-360', width: 360, height: 740, mobile: true },
  { name: 'phone-stretto', width: 340, height: 720, mobile: true, active: true },
  { name: 'phone-filtri-aperti', width: 340, height: 720, mobile: true, active: true, open: true },
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: 'desktop-filtri-attivi', width: 1280, height: 800, mobile: false, active: true },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-ui-'));
const kids = [];
function cleanup() { for (const k of kids) try { k.kill('SIGKILL'); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); }
process.on('exit', cleanup);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Fixture repo: enough issues to show every filter (children, a stale backlog, proposals, long labels).
function fixture() {
  const repo = path.join(tmp, 'repo');
  for (const d of ['open', 'done', 'proposed']) fs.mkdirSync(path.join(repo, 'issues', d), { recursive: true });
  const issue = (dir, id, title, head) => fs.writeFileSync(path.join(repo, 'issues', dir, `${id}-${title.toLowerCase().replace(/\W+/g, '-')}.md`),
    `# ${title}\n\nOpened: 2026-01-01\n${head}\n\n## Problema\nTesto di prova.\n`);
  issue('open', '001', 'Epic con figli', 'Blocked on: -\nStatus: todo\nLabels: dashboard, manutenzione-automatica-lunga');
  for (let n = 2; n < 12; n++) issue('open', String(n).padStart(3, '0'), `Figlia numero ${n}`, `Blocked on: -\nStatus: todo\nParent: 001\nLabels: etichetta-${n}`);
  issue('open', '012', 'Backlog fermo da tanto', 'Blocked on: -\nStatus: backlog\nPriority: high');
  issue('open', '013', 'In corso', 'Blocked on: user (prova)\nStatus: in-progress');
  issue('done', '014', 'Chiusa', 'Blocked on: -\nStatus: done\nClosed: 2026-01-02');
  const today = new Date().toISOString().slice(0, 10);
  issue('done', '020', 'Chiusa di oggi', `Blocked on: -\nStatus: done\nClosed: ${today}`);
  issue('done', '021', 'Scartata di oggi', `Blocked on: -\nStatus: done\nLabels: scartata\nClosed: ${today}`);
  issue('proposed', '015', 'Proposta del brain', 'Blocked on: -\nStatus: backlog\nLabels: proposed\nSource: brain');
  issue('proposed', '016', 'Proposta del sistema', 'Blocked on: -\nStatus: backlog\nLabels: proposed\nSource: system');
  issue('open', '017', 'Aspetta una data', 'Blocked on: -\nStatus: todo\nNot before: 2099-12-31');
  issue('open', '018', 'Data passata', 'Blocked on: -\nStatus: todo\nNot before: 2020-01-01');
  issue('open', '090', 'Bloccata da due', 'Blocked on: issue 012, 014\nStatus: todo');
  fs.writeFileSync(path.join(repo, 'issues', 'open', '019-tre-passi-hitl.md'),
    '# Tre passi hitl\n\nOpened: 2026-01-01\nBlocked on: user (passi)\nStatus: in-progress\n\n## Esecuzione\n- [x] Passo fatto da Claude\n' +
    '- [ ] (HITL) Primo? (perché)\n- [ ] (HITL) Secondo? (perché)\n- [ ] (HITL) Terzo? (perché)\n- [ ] Passo autonomo dopo\n');
  // Immagini di una issue (issue 550): due png finti su #003, più un file non ammesso.
  const as = path.join(repo, 'issues', 'assets', '003'); fs.mkdirSync(as, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(path.join(as, 'uno-chiaro.png'), png); fs.writeFileSync(path.join(as, 'due-scuro.png'), png); fs.writeFileSync(path.join(as, 'note.txt'), 'x');
  const old = { ...process.env, GIT_AUTHOR_DATE: '2025-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2025-01-01T00:00:00Z' };
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { env: old, stdio: 'ignore' });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');
  return repo;
}

// Password file in tracker-passwd's format (cheap scrypt cost: test only).
function stateDir(pw) {
  const st = path.join(tmp, 'state'), s = crypto.randomBytes(16), N = 1024, r = 8, p = 1;
  const k = crypto.scryptSync(pw, s, 32, { N, r, p });
  fs.mkdirSync(st);
  fs.writeFileSync(path.join(st, 'password'), ['scrypt', N, r, p, s.toString('base64'), k.toString('base64')].join('$') + '\n');
  return st;
}

async function waitFor(fn, ms = 10000) { for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await fn()) return true; return false; }

async function waitHttp(url, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
    try { const r = await fetch(url); if (r.status < 500) return r; } catch {}
  }
  throw new Error(`nessuna risposta da ${url}`);
}

// Minimal DevTools protocol client over one page target.
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map(), waiters = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { ok, ko } = pending.get(m.id); pending.delete(m.id);
      m.error ? ko(new Error(`${m.error.message}`)) : ok(m.result);
    } else if (m.method) for (const w of waiters.filter(w => w.method === m.method)) { waiters.splice(waiters.indexOf(w), 1); w.ok(m.params); }
  };
  const ready = new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('websocket DevTools')); });
  return {
    ready, close: () => ws.close(),
    send: (method, params = {}) => new Promise((ok, ko) => { pending.set(++id, { ok, ko }); ws.send(JSON.stringify({ id, method, params })); }),
    once: method => new Promise(ok => waiters.push({ method, ok })),
  };
}

// Runs in the page: every visible box of the top bar and of the filter bar must not overlap another
// one nor stick out of the viewport; selects must stay wide enough to read.
function layoutCheck() {
  const vis = el => !el.hidden && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const box = el => el.getBoundingClientRect();
  const label = el => el.id ? `#${el.id}` : el.className ? `.${String(el.className).split(' ')[0]}` : el.tagName.toLowerCase();
  const errs = [], W = document.documentElement.clientWidth;
  const groups = [[...document.querySelectorAll('.top > *')], [...document.querySelectorAll('.filters > *')], [...document.querySelectorAll('.tabs > *')], [...document.querySelectorAll('.actions > *')]];
  const pl = document.querySelector('a#projects-link[href="projects.html"]');
  if (!pl || !vis(pl)) errs.push('manca il link a projects.html nella barra');
  for (const g of groups) {
    const els = g.filter(vis);
    for (const el of els) {
      const b = box(el);
      if (b.left < -0.5 || b.right > W + 0.5) errs.push(`${label(el)} esce dallo schermo (${Math.round(b.left)}..${Math.round(b.right)} su ${W})`);
    }
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = box(els[i]), b = box(els[j]);
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0.5 && h > 0.5) errs.push(`${label(els[i])} si sovrappone a ${label(els[j])} (${Math.round(w)}x${Math.round(h)} px)`);
    }
  }
  for (const s of document.querySelectorAll('.filters select')) if (vis(s) && box(s).width < 90) errs.push(`${label(s)} troppo stretto (${Math.round(box(s).width)} px)`);
  for (const c of document.querySelectorAll('.filters .fsel')) {
    const x = c.querySelector('.fclear'), s = c.querySelector('select');
    if (x && vis(x) && (box(x).right > box(s).right + 0.5 || box(x).left < box(s).left)) errs.push(`la × di ${label(s)} esce dal selettore`);
  }
  const tn = document.querySelector('.tabs [aria-selected=true] .tab-name');
  if (tn && vis(tn) && tn.scrollWidth > tn.clientWidth + 0.5) errs.push(`nome della scheda «${tn.textContent}» tagliato`);
  if (document.documentElement.scrollWidth > W + 0.5) errs.push(`la pagina scorre in orizzontale (${document.documentElement.scrollWidth} > ${W})`);
  return errs;
}

async function main() {
  const pw = crypto.randomBytes(12).toString('hex');
  const port = 20000 + crypto.randomInt(20000), dport = port + 1;
  const pjFile = path.join(tmp, 'projects-issues.json');
  fs.mkdirSync(path.join(tmp, 'writes'));
  fs.writeFileSync(pjFile, JSON.stringify({ updated: '24/10 10:00', projects: { sumisura: { repo: 'o/sumisura', issues: [
    { number: 7, title: 'Bug aperto', state: 'open', url: 'https://github.com/o/sumisura/issues/7', author: 'o', labels: ['bug'], updated: '2026-10-20T10:00:00Z', trust: 'author' },
    { number: 8, title: 'Issue di un estraneo', state: 'open', url: 'https://github.com/o/sumisura/issues/8', author: 'x', labels: [], updated: '2026-10-21T10:00:00Z', trust: '' },
    { number: 9, title: 'Serve il tuo ok', state: 'open', url: 'https://github.com/o/sumisura/issues/9', author: 'o', labels: ['needs-owner'], updated: '2026-10-22T10:00:00Z', trust: 'author' },
    { number: 6, title: 'Vecchia chiusa', state: 'closed', url: 'https://github.com/o/sumisura/issues/6', author: 'o', labels: [], updated: '2026-10-01T10:00:00Z', trust: 'author' }] } } }));
  const relFile = path.join(tmp, "release-gate.json"); fs.mkdirSync(path.join(tmp, "rreq"));
  fs.writeFileSync(relFile, JSON.stringify({ updated: 1, paused: false, projects: { sumisura: { status: "announced", version: "0.5.0", pr: 9, url: "https://github.com/o/sumisura/pull/9",
    changelog: "## [0.5.0](https://github.com/o/s/compare/v0.4.0...v0.5.0) (2026-10-25)\n\n### Features\n\n* **cv:** nuovo modello ([abc1234](https://github.com/o/s/commit/abc1234))\n\n### Bug Fixes\n\n* corregge <b>il tetto</b> ([def5678](https://github.com/o/s/commit/def5678))\n",
    last_tag: "v0.4.0", last_at: "2026-10-01T10:00:00Z", rules: [{ rule: "ci", ok: true, why: "CI verde" }], announced_at: 1, release_at: Math.floor(Date.now() / 1000) + 20 * 3600 } } }));
  const jobsFile = path.join(tmp, "jobs.json"); const nowS = Math.floor(Date.now() / 1000);
  fs.writeFileSync(jobsFile, JSON.stringify({ generated: nowS, categories: {
    backup: { name: "Backup", ok: 2, error: 1, late: 0, nodata: 0, problem: true, label: "⚠ 1 con errore", jobs: [
      { title: "Backup password", when: "Ogni notte alle 3:37", status: "error", t: nowS - 600, rc: 3, dur: 2 }, { title: "Backup calendari", when: "Ogni notte alle 3:47", status: "ok", t: nowS - 900, rc: 0, dur: 1 }, { title: "Backup libreria", when: "Ogni notte alle 3:52", status: "ok", t: nowS - 900, rc: 0, dur: 1 }] },
    sistema: { name: "Sistema", ok: 1, error: 0, late: 0, nodata: 1, problem: false, label: "✓ 1 ok", jobs: [
      { title: "Batteria e allarmi", when: "Ogni minuto", status: "ok", t: nowS - 30, rc: 0, dur: 0 }, { title: "Pulizia app Motorola", when: "Ogni 15 minuti", status: "nodata" }] } } }));
  const pjList = path.join(tmp, 'projects'); fs.writeFileSync(pjList, 'home-server | - | - | active\nsumisura | https://github.com/o/sumisura.git | - | active\n');
  const deployLog = path.join(tmp, 'deploy.log'), td = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(deployLog, `2020-01-01 10:00:00 ok\n${td} 09:00:00 ok\n${td} 10:30:12 failed check: test:x.sh\n${td} 11:00:00 rm -rf /\n`);
  const env = { ...process.env, TRACKER_PROJECTS_ISSUES: pjFile, TRACKER_JOBS_STATUS: jobsFile, TRACKER_PROJECTS_WRITES: path.join(tmp, 'writes'), TRACKER_DEPLOY_LOG: deployLog, TRACKER_RELEASE_STATE: relFile, TRACKER_RELEASE_REQ: path.join(tmp, "rreq"), TRACKER_ORIGINS: `http://127.0.0.1:${port}`, TRACKER_REPO: fixture(), TRACKER_STATE: stateDir(pw), TRACKER_PORT: String(port),
    TRACKER_SETTINGS: path.join(tmp, 'settings.env'), TRACKER_SUGGESTIONS: path.join(tmp, 'sugg'), TRACKER_QUEUE_CONFIG: path.join(tmp, 'queue.json'), TRACKER_AUTO_STATUS: path.join(tmp, 'none'),
    TRACKER_AUTO_REQUEST: path.join(tmp, 'auto-req.json'), HS_QUEUE_PROJECTS_JSON: pjFile, HS_PROJECTS_FILE: pjList, TRACKER_AUTO_LOG: path.join(tmp, 'none'), TRACKER_AUTO_USAGE: path.join(tmp, 'usage-recent.json'),
    TRACKER_PRS_TO_MERGE: path.join(tmp, 'none'), TRACKER_MAIL_SETUP: path.join(tmp, 'mail-setup'), TRACKER_MAIL_STATUS: path.join(tmp, 'mail-status') };
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'tracker', 'server.js')], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  kids.push(srv);
  const base = `http://127.0.0.1:${port}`;
  await waitHttp(`${base}/`, 15000);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: pw }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  if (!login.ok || !cookie.includes('=')) throw new Error(`login al tracker di prova fallito (${login.status})`);
  const [cname, cvalue] = [cookie.slice(0, cookie.indexOf('=')), cookie.slice(cookie.indexOf('=') + 1)];

  const chrome = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    '--hide-scrollbars', `--remote-debugging-port=${dport}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${path.join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  kids.push(chrome);
  await waitHttp(`http://127.0.0.1:${dport}/json/version`, 60000);
  const page = (await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json()).find(t => t.type === 'page');
  const c = cdp(page.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable');
  await c.send('Network.enable');
  await c.send('Network.setCookie', { name: cname, value: cvalue, url: base, httpOnly: true });

  fs.mkdirSync(SHOTS, { recursive: true });
  const evaluate = async expr => (await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  // Idempotent read that must return an object: retried when the page did not answer (undefined under load, issues 514, 532).
  const evaluateRead = async expr => { let v; for (let i = 0; i < 5 && v === undefined; i++) { if (i) await sleep(500); v = await evaluate(expr); }
    if (v === undefined) throw new Error('la pagina non ha risposto a una lettura'); return v; };
  // Helpers for new UI tests (issue 178): a test is a few lines of these.
  // openDrawer(id, probe?): opens the issue's drawer and waits until it is loaded (and until the optional page expression is true).
  const openDrawer = async (id, probe = 'true') => { await evaluate(`openIssue('${id}')`);
    return waitFor(() => evaluate(`!!S.detail && S.detail.id === '${id}' && !!document.querySelector('#drawer .props') && !!(${probe})`)); };
  // clickText(selector, text): clicks the first element matching selector whose text is exactly text.
  const clickText = (sel, text) => evaluate(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent === ${JSON.stringify(text)}); if (e) e.click(); return !!e; })()`);
  // fill(selector, value): sets an input/select/textarea value and fires input+change.
  const fill = (sel, value) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.value = ${JSON.stringify(value)};
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  // issueFile(dir, prefix): reads the fixture's issue file after an action (e.g. issueFile('open', '019')).
  const issueFile = (dir, prefix) => { const d = path.join(env.TRACKER_REPO, 'issues', dir), n = fs.readdirSync(d).find(x => x.startsWith(prefix + '-'));
    return n ? fs.readFileSync(path.join(d, n), 'utf8') : null; };
  let failed = 0;
  for (const k of CASES) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: k.width, height: k.height, deviceScaleFactor: 1, mobile: k.mobile });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/` });
    await loaded;
    let ok = false;
    for (const end = Date.now() + 15000; !ok && Date.now() < end; await sleep(200)) {
      ok = await evaluate(`!document.querySelector('#app').hidden && document.querySelectorAll('#board .card').length > 0 && !document.querySelector('#f-children').hidden`);
    }
    if (!ok) throw new Error(`la board non si è caricata (${k.name})`);
    if (k.active) {
      await evaluate(`(() => { for (const id of ['f-prio', 'f-label', 'f-entry']) { const s = document.getElementById(id);
        s.value = s.options[s.options.length - 1].value; s.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
      await sleep(300);
    }
    const rectOf = `(() => { const r = document.querySelector('#f-toggle').getBoundingClientRect(); return [r.x, r.y, r.width].map(Math.round).join(); })()`;
    const before = await evaluate(rectOf);
    if (k.open) { await evaluate(`document.querySelector('#f-toggle').click()`); await sleep(200); }
    const errs = await evaluate(`(${layoutCheck})()`);
    // Issue 226: opening the filters must not move «Filtri».
    if (k.mobile && k.open && await evaluate(rectOf) !== before) errs.push(`«Filtri» si sposta aprendo i filtri (${before} -> ${await evaluate(rectOf)})`);
    // Phones (issue 155): filters folded unless opened, «Filtri · N» counts the active ones, first card on screen.
    if (k.mobile) errs.push(...await evaluate(`(() => { const e = [], t = document.querySelector('#f-toggle'), want = ${k.active ? "'Filtri · 3'" : "'Filtri'"};
      const shown = !!document.querySelector('#f-prio').getClientRects().length;
      if (shown !== ${!!k.open}) e.push(shown ? 'menu dei filtri aperti senza toccare «Filtri»' : 'menu dei filtri chiusi dopo il tocco su «Filtri»');
      if (t.textContent !== want) e.push(\`bottone «\${t.textContent}», atteso «\${want}»\`);
      if (${!!k.active} === document.querySelector('#f-reset').hidden) e.push('× per azzerare i filtri non coerente');
      const c = document.querySelector('#board .col.active .card');
      if (c && c.getBoundingClientRect().top > innerHeight - 40) e.push(\`prima card fuori schermo (top \${Math.round(c.getBoundingClientRect().top)})\`);
      return e; })()`));
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOTS, `${k.name}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    if (errs.length) { failed++; console.log(`FAIL ${k.name} (${k.width}px): ${file}`); for (const e of errs) console.log(`    ${e}`); }
    else console.log(`ok ${k.name} (${k.width}px): ${file}`);
  }
  // Tap on a card's ⏳ chip at phone width (issue 154): the popover explains it, the card stays closed.
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await evaluate(`S.prio = S.label = S.entry = ''; S.tab = 'todo'; renderBoard()`);
  await sleep(300);
  const at = await evaluate(`(() => { const t = document.querySelector('#board .card[data-id="017"] .not-before');
    if (!t) return null; t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!at) { failed++; console.log('FAIL tocco: chip ⏳ della #017 non trovato sulla board'); }
  else {
    await sleep(200);
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(400);
    const got = await evaluate(`(() => { const p = document.querySelector('.tip-pop'); return { tip: p && !p.hidden ? p.textContent : '', open: S.open, drawer: !document.querySelector('#drawer').hidden }; })()`);
    if (got.tip === 'La manutenzione automatica la prende dal 31/12' && !got.open && !got.drawer) console.log(`ok tocco ⏳: «${got.tip}», card chiusa`);
    else { failed++; console.log(`FAIL tocco ⏳: popover «${got.tip}», issue aperta ${got.open || '-'}, drawer ${got.drawer ? 'visibile' : 'nascosto'}`); }
  }
  // Tap on #NNN inside «Bloccata da» (issue 228): opens that issue; the text around it still shows the tip.
  for (const w of [390, 1280]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: w < 600 });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: w < 600, maxTouchPoints: 1 });
    await evaluate(`hideDrawer(); S.prio = S.label = S.entry = ''; S.tab = S.issues.find(i => i.id === '090').column; renderBoard()`);
    await sleep(300);
    const pos = sel => evaluate(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); if (!t) return null; t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return { x: r.x + 3, y: r.y + r.height / 2 }; })()`);
    const tapAt = async p => { await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] }); await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(400); };
    const state = () => evaluate(`(() => { const p = document.querySelector('.tip-pop'); return { tip: p && !p.hidden ? p.textContent : '', open: S.open, drawer: !document.querySelector('#drawer').hidden }; })()`);
    const b = await pos('#board .card[data-id="090"] .blocked-on button');
    if (!b) { failed++; console.log(`FAIL #NNN bloccata (${w}px): bottone non trovato`); continue; }
    await tapAt(b);
    let g = await state();
    if (g.open === '012' && g.drawer && !g.tip) console.log(`ok tocco #012 in «Bloccata da» (${w}px): apre la issue`);
    else { failed++; console.log(`FAIL tocco #012 (${w}px): issue aperta ${g.open || '-'}, popover «${g.tip}»`); }
  }
  // Padre cliccabile nel drawer (issue 258): the chip next to the «Padre» select opens the parent; no overflow.
  for (const w of [390, 1280]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: w < 600 });
    await evaluate(`openIssue('002')`);
    await sleep(500);
    const pc = await evaluate(`(() => { const b = document.querySelector('#drawer .parent-chip'); if (!b) return null; const d = document.querySelector('#drawer'); return { text: b.textContent, over: d.scrollWidth > d.clientWidth + 1 }; })()`);
    if (!pc || !/^↑ 001 Epic con figli/.test(pc.text) || pc.over) { failed++; console.log(`FAIL padre nel drawer (${w}px): ${JSON.stringify(pc)}`); continue; }
    await evaluate(`document.querySelector('#drawer .parent-chip').click()`);
    await sleep(500);
    const op = await evaluate(`S.open`);
    if (op === '001') console.log(`ok padre cliccabile nel drawer (${w}px)`);
    else { failed++; console.log(`FAIL padre nel drawer (${w}px): aperta ${op}`); }
  }
  // Immagini nel drawer (issue 550): miniature entro la larghezza, endpoint con regole strette.
  for (const w of [390, 1280]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: w < 600 });
    await evaluate(`openIssue('003')`);
    await sleep(700);
    const g = await evaluate(`(() => { const d = document.querySelector('#drawer'); const s = [...document.querySelectorAll('#drawer .shot')];
      return { n: s.length, names: s.map(x => x.textContent), ok: s.every(x => { const r = x.getBoundingClientRect(); return r.right <= d.getBoundingClientRect().right + 1 && r.width > 50; }), over: d.scrollWidth > d.clientWidth + 1,
      loaded: [...document.querySelectorAll('#drawer .shot img')].every(i => i.complete && i.naturalWidth === 1) }; })()`);
    if (g.n === 2 && g.names.join() === 'due-scuro.png,uno-chiaro.png' && g.ok && !g.over && g.loaded) console.log(`ok immagini nel drawer (${w}px)`);
    else { failed++; console.log(`FAIL immagini nel drawer (${w}px): ${JSON.stringify(g)}`); }
  }
  {
    const st = async (p, auth = true) => (await fetch(base + p, { headers: auth ? { cookie } : {} })).status;
    const r = await fetch(base + '/api/issues/003/images/uno-chiaro.png', { headers: { cookie } });
    const got = [r.status, r.headers.get('content-type'), r.headers.get('x-content-type-options'), await st('/api/issues/003/images/uno-chiaro.png', false),
      await st('/api/issues/003/images/note.txt'), await st('/api/issues/003/images/..%2F..%2Fopen%2F001-epic-con-figli.md'), await st('/api/issues/003/images/..%2Fx.png'),
      await st('/api/issues/002/images/uno-chiaro.png'), await st('/api/issues/003/images/manca.png')];
    if (JSON.stringify(got) === JSON.stringify([200, 'image/png', 'nosniff', 401, 404, 404, 404, 404, 404])) console.log('ok immagini: servite solo png valide, 401 senza sessione, 404 per ../ e estensioni non ammesse');
    else { failed++; console.log('FAIL immagini endpoint: ' + JSON.stringify(got)); }
  }
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  // Issue dei Progetti nella board (issue 184): the filter swaps the columns to the GitHub copy, read-only.
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await fill('#f-project', 'sumisura');
  await sleep(300);
  const pj = await evaluate(`(() => { const col = n => [...document.querySelectorAll('#board .col[data-col="' + n + '"] .card')].map(e => e.dataset.id);
    return { todo: col('todo'), done: col('done'), add: document.querySelectorAll('#board .col .add').length, bad: document.querySelector('.pj-untrusted')?.textContent || '' }; })()`);
  if ([...pj.todo].sort().join() === 'sumisura#7,sumisura#8,sumisura#9' && pj.done.join() === 'sumisura#6' && !pj.add && /^non fidata/.test(pj.bad)) console.log('ok board: issue di sumisura in Da fare/Fatte, sola lettura, non fidata marcata');
  else { failed++; console.log('FAIL board progetti: ' + JSON.stringify(pj)); }
  await fill('#f-project', '');
  await sleep(200);
  if (!await evaluate(`!!document.querySelector('#board .card[data-id="017"], #board .card[data-id="013"]')`)) { failed++; console.log('FAIL board: tornando a home-server le issue locali non ci sono'); }
  // Drawer (issue 153): a "Non prima del" row only while `Not before:` is still ahead.
  for (const [id, want] of [['017', '⏳ 31/12/2099'], ['018', ''], ['013', '']]) {
    await evaluate(`openIssue('${id}')`);
    let row = null;
    for (const end = Date.now() + 10000; row === null && Date.now() < end; await sleep(200)) {
      row = await evaluate(`(() => { if (!S.detail || S.detail.id !== '${id}' || !document.querySelector('#drawer .props')) return null;
        const k = [...document.querySelectorAll('#drawer .props > .k')].find(e => e.textContent === 'Non prima del');
        return k ? k.nextElementSibling.textContent : ''; })()`);
    }
    if (row === want) console.log(`ok drawer #${id}: «${want || 'nessuna riga Non prima del'}»`);
    else { failed++; console.log(`FAIL drawer #${id}: atteso «${want}», trovato «${row}»`); }
  }
  // Rispondi e sblocca (issue 173): answer steps 1 and 3 of #019 from the drawer in one send.
  const formOk = await openDrawer('019', `document.querySelector('#drawer .proposal .btn.primary')`);
  const sel = async n => evaluate(`document.querySelectorAll('#drawer .reply-step').length`);
  if (!formOk) { failed++; console.log('FAIL rispondi: pulsante non trovato nel drawer #019'); }
  else {
    await clickText('#drawer .proposal .btn', 'Rispondi');
    const n = await sel();
    await evaluate(`(() => { const r = document.querySelectorAll('#drawer .reply-step'); const set = (i, k, t) => { r[i].querySelector('select').value = k; r[i].querySelector('textarea').value = t; };
      set(0, 'answer', 'Sì, raccomandato'); set(2, 'done', 'creato'); [...document.querySelectorAll('#drawer .btn.primary')].find(b => b.textContent === 'Invia').click(); })()`);
    await sleep(1500);
    const file = issueFile('open', '019');
    const errs = [];
    if (n !== 3) errs.push(`riquadri ${n}, attesi 3`);
    if (!/^Blocked on: -$/m.test(file)) errs.push('Blocked on non azzerato');
    if (!/^- \[x\] \(HITL\) Primo\?/m.test(file)) errs.push('passo 1 non spuntato');
    if (!/^- \[ \] \(HITL\) Secondo\?/m.test(file)) errs.push('passo 2 spuntato o perso');
    if (!/^- \[x\] \(HITL\) Terzo\?/m.test(file)) errs.push('passo 3 non spuntato');
    if (!/\*\*\(HITL\) Primo\? \(perché\)\*\*[\s\S]*Sì, raccomandato/.test(file)) errs.push('commento del passo 1 mancante');
    if (!/^### .* \(.+\)$/m.test(file)) errs.push('commento mancante');
    const queue = execFileSync(process.execPath, [path.join(__dirname, '..', 'tracker', 'issues.js'), '--queue', env.TRACKER_REPO], { encoding: 'utf8' });
    if (!queue.split('\n').includes('019-tre-passi-hitl.md')) errs.push('la coda di ops-auto non propone la issue');
    const sh = path.join(__dirname, 'ops-auto-hitl.sh'), copy = path.join(tmp, 'answered.md');
    fs.writeFileSync(copy, file);
    try { execFileSync('sh', [sh, copy], { stdio: 'pipe', cwd: path.join(__dirname, '..', '..', '..') }); }
    catch (e) { errs.push('giro ops-auto: ' + String(e.stdout || e.message).trim().split('\n').filter(l => /FAIL/.test(l)).join('; ')); }
    if (errs.length) { failed++; console.log('FAIL rispondi:'); for (const e of errs) console.log('    ' + e); }
    else console.log('ok rispondi: commento, spunte 1 e 3, sbloccata, in coda, giro ops-auto con il 2° passo aperto');
  }
  // Link dalla notifica (issue 309): #ID/rispondi apre il drawer già sul modulo; #ID no; aperto due volte non duplica.
  {
    await evaluate(`hideDrawer(); history.replaceState(null, '', location.pathname)`);
    const probe = async h => { await evaluate(`location.hash = '${h}'`); await waitFor(() => evaluate(`!document.getElementById('drawer').hidden`)); await sleep(500);
      return evaluate(`({ steps: document.querySelectorAll('#drawer .reply-step').length, hash: location.hash, open: S.open })`); };
    const errs = [];
    const plain = await probe('#019');
    if (plain.steps !== 0 || plain.open !== '019') errs.push(`#019: ${JSON.stringify(plain)}`);
    await evaluate(`hideDrawer(); history.replaceState(null, '', location.pathname)`);
    const a = await probe('#019/rispondi');
    if (a.steps !== 1 || a.open !== '019' || a.hash !== '#019/rispondi') errs.push(`#019/rispondi: ${JSON.stringify(a)}`);
    await evaluate(`hideDrawer(); history.replaceState(null, '', location.pathname)`);
    const b = await probe('#019/rispondi');
    if (b.steps !== 1) errs.push(`seconda apertura: ${JSON.stringify(b)}`);
    if (errs.length) { failed++; console.log('FAIL link rispondi:'); for (const e of errs) console.log('    ' + e); }
    else console.log('ok link #ID/rispondi: modulo aperto, #ID solo il drawer, due aperture uguali');
  }
  // Cosa è successo (issue 326): last 7 days, plus the message for an empty period.
  {
    // cost next to the closed issues (issue 365): only #020 has data; read from usage.json at each request
    fs.writeFileSync(path.join(tmp, 'usage-recent.json'), JSON.stringify({ byIssue: { '020': { costUsd: 1.5, runs: 3, attempts: 2 } } }));
    await c.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: true });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/recent.html` });
    await loaded;
    const ready = await waitFor(() => evaluate(`document.querySelectorAll('.rc-day').length > 0`));
    const txt = ready ? await evaluate(`document.getElementById('rc-list').innerText`) : '';
    await evaluate(`window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ days: [] }) }); load()`);
    const empty = await waitFor(() => evaluate(`document.getElementById('rc-list').textContent === 'Niente di nuovo'`));
    const good = /#020 Chiusa di oggi/.test(txt) && /#021 Scartata di oggi/.test(txt) && !/#014/.test(txt) && /09:00 riuscito/.test(txt)
      && /10:30 fallito \(check: test:x\.sh\)/.test(txt) && !/rm -rf/.test(txt) && !/2020/.test(txt);
    const cost = /#020 Chiusa di oggi · \$1\.50, 3 giri, 2 tentativi/.test(txt) && !/#021 Scartata di oggi ·/.test(txt);
    const wide = await evaluate(`document.documentElement.scrollWidth > document.documentElement.clientWidth`);
    fs.rmSync(path.join(tmp, 'usage-recent.json'), { force: true });
    if (good && empty && cost && !wide) console.log('ok recent.html: issue chiuse, scartate, deploy, costo (360 px, senza dato niente); periodo vuoto');
    else { failed++; console.log('FAIL recent.html: ' + JSON.stringify({ txt, empty, cost, wide })); }
  }
  // Scrittura su GitHub (issue 184): a card on /projects.html opens the drawer; a comment is queued for projects-issue-apply.
  {
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/projects.html` });
    await loaded;
    const ready = await waitFor(() => evaluate(`document.querySelectorAll('.pj-cards .card').length > 0`));
    let ok = false, seen = '';
    if (ready) {
      await evaluate(`document.querySelector('.pj-cards .card').click()`);
      const btns = await evaluate(`[...document.querySelectorAll('.pj-panel button')].map(b => b.textContent).join()`);
      await evaluate(`(() => { document.querySelector('.pj-panel textarea').value = 'ciao dal test'; document.querySelector('#pj-comment').click(); })()`);
      await sleep(800);
      const files = fs.readdirSync(env.TRACKER_PROJECTS_WRITES).filter(f => f.endsWith('.req.json'));
      const rq = files.length === 1 ? JSON.parse(fs.readFileSync(path.join(env.TRACKER_PROJECTS_WRITES, files[0]), 'utf8')) : {};
      ok = /^Commenta,/.test(btns) && /Chiudi/.test(btns) && rq.action === 'comment' && rq.text === 'ciao dal test' && rq.project === 'sumisura' && Number.isInteger(rq.number);
      seen = btns + ' ' + JSON.stringify(rq);
    }
    if (ok) console.log('ok projects.html: card apre il drawer, commento messo in coda');
    else { failed++; console.log('FAIL projects.html azioni: ' + (ready ? seen : 'pagina non caricata')); }
  }
  // Rispondi per le issue dei Projects con needs-owner (issue 307): letta dal server, un riquadro per passo, un solo invio.
  {
    const errs = [];
    const wdir = env.TRACKER_PROJECTS_WRITES;
    for (const f of fs.readdirSync(wdir)) fs.rmSync(path.join(wdir, f));
    const go = async hash => { const b = c.once('Page.loadEventFired'); await c.send('Page.navigate', { url: 'about:blank' }); await b; const l = c.once('Page.loadEventFired'); await c.send('Page.navigate', { url: `${base}/projects.html${hash}` }); await l; };
    await go('#sumisura-9');
    await waitFor(() => evaluate(`!!document.querySelector('#pj-reply')`));
    // risponde al server finto: aspetta la richiesta read e scrive la risposta
    const answerRead = async () => {
      let rq; await waitFor(async () => { const f = fs.readdirSync(wdir).filter(x => x.endsWith('.req.json')); if (f.length) rq = JSON.parse(fs.readFileSync(path.join(wdir, f[0]), 'utf8')); return !!rq; }, 5000);
      return rq;
    };
    await evaluate(`document.querySelector('#pj-reply').click(); document.querySelector('#pj-reply').click()`);
    if (!await evaluate(`!!document.querySelector('.pj-wait')`)) errs.push('nessun indicatore di attesa dopo Rispondi');
    const rq = await answerRead();
    if (!rq || rq.action !== 'read' || rq.number !== 9) errs.push('richiesta read non messa in coda: ' + JSON.stringify(rq));
    else {
      fs.writeFileSync(path.join(wdir, rq.id + '.res.json'), JSON.stringify({ id: rq.id, ok: true, msg: 'letto', steps: ['(HITL) scegli A o B', '(HITL) conferma'], last: { by: 'bot', text: 'Serve il tuo ok <b>x</b>' }, needs_owner: true }));
      const shown = await waitFor(() => evaluate(`document.querySelectorAll('.reply-step').length === 2`), 8000);
      if (!shown) errs.push('i due riquadri non compaiono');
      else {
        if (fs.readdirSync(wdir).filter(x => x.endsWith('.req.json')).length !== 1) errs.push('tocchi ripetuti: più di una richiesta read');
        if (await evaluate(`document.querySelector('.pj-last').textContent`) !== 'Serve il tuo ok <b>x</b>') errs.push('ultimo commento non mostrato come testo');
        await evaluate(`(() => { document.querySelector('#pj-answer-send').click(); })()`);
        if (!/Scegli/.test(await evaluate(`document.querySelector('#drawer [role=status]').textContent`))) errs.push('invio vuoto non rifiutato');
        await evaluate(`(() => { const r = document.querySelectorAll('.reply-step'); r[0].querySelector('select').value = 'answer'; r[0].querySelector('textarea').value = 'A'; r[1].querySelector('select').value = 'done'; })()`);
        await evaluate(`document.querySelector('#pj-answer-send').click(); document.querySelector('#pj-answer-send').click()`);
        await sleep(800);
        const files = fs.readdirSync(wdir).filter(x => x.endsWith('.req.json') && x !== rq.id + '.req.json');
        const aq = files.length === 1 ? JSON.parse(fs.readFileSync(path.join(wdir, files[0]), 'utf8')) : {};
        if (aq.action !== 'answer' || JSON.stringify(aq.answers) !== JSON.stringify([{ text: '(HITL) scegli A o B', kind: 'answer', note: 'A' }, { text: '(HITL) conferma', kind: 'done', note: '' }])) errs.push('richiesta answer: ' + files.length + ' ' + JSON.stringify(aq));
      }
    }
    // niente Rispondi su una issue senza needs-owner o non fidata
    await go('#sumisura-8');
    await waitFor(() => evaluate(`!document.getElementById('drawer').hidden`));
    if (await evaluate(`!!document.querySelector('#pj-reply')`)) errs.push('Rispondi su una issue non fidata');
    if (errs.length) { failed++; console.log('FAIL rispondi Projects: ' + errs.join('; ')); } else console.log('ok rispondi Projects: lettura, due riquadri, invio unico con tocchi ripetuti');
  }
  // «Lavora su questa issue» per le issue dei Projects (issue 205): bottone solo se aperta e fidata; il server rifiuta il resto.
  {
    const errs = [];
    const post = body => evaluate(`fetch('/api/auto/run', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) }).then(async r => [r.status, (await r.json().catch(() => ({}))).error || ''])`);
    for (const [id, want] of [['sumisura#8', 409], ['sumisura#6', 409], ['sumisura#99', 404], ['sumisura#x', 400], ['Sumisura#7', 400], ['altro#7', 404]]) {
      const [st] = await post({ issue: id });
      if (st !== want) errs.push(`${id}: ${st}, atteso ${want}`);
    }
    if (fs.existsSync(env.TRACKER_AUTO_REQUEST)) errs.push('una richiesta rifiutata è stata scritta');
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/projects.html` });
    await loaded;
    await waitFor(() => evaluate(`document.querySelectorAll('.pj-cards .card').length > 0`));
    const open = n => evaluate(`(() => { const c = [...document.querySelectorAll('.pj-cards .card')].find(x => x.textContent.includes(${JSON.stringify(n)})); if (!c) return false; c.click(); return !!document.querySelector('#pj-work'); })()`);
    if (await open('Issue di un estraneo')) errs.push('bottone su issue non fidata');
    if (!await open('Bug aperto')) errs.push('manca il bottone su issue fidata');
    else {
      await evaluate(`document.querySelector('#pj-work').click()`);
      await sleep(800);
      const rq = fs.existsSync(env.TRACKER_AUTO_REQUEST) ? JSON.parse(fs.readFileSync(env.TRACKER_AUTO_REQUEST, 'utf8')) : {};
      if (rq.issue !== 'sumisura#7') errs.push('richiesta: ' + JSON.stringify(rq));
      if (await evaluate(`!document.querySelector('#pj-work').disabled`)) errs.push('bottone ancora attivo dopo l\'invio');
      fs.rmSync(env.TRACKER_AUTO_REQUEST, { force: true });
    }
    if (errs.length) { failed++; console.log('FAIL lavora su issue dei Projects:'); for (const e of errs) console.log('    ' + e); }
    else console.log('ok lavora su issue dei Projects: fidata accettata, non fidata/chiusa/ignota/malformata rifiutate, richiesta scritta');
  }
  // Pagina Progetti come la board (issue 204, 203): sezioni per Progetto, card, drawer; tocchi ripetuti non duplicano; 390 e 1280 px, tema scuro; screenshot.
  for (const [w, hgt, mobile] of [[390, 800, true], [1280, 800, false]]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/projects.html` });
    await loaded;
    const ready = await waitFor(() => evaluate(`document.querySelectorAll('.pj-cards .card').length > 0`));
    const errs = [];
    if (!ready) errs.push('pagina non caricata');
    else {
      const info = () => evaluate(`({ panels: document.querySelectorAll('.pj-panel').length, open: !document.getElementById('drawer').hidden, secs: document.querySelectorAll('.pj-sec').length })`);
      const sc = await info();
      if (sc.secs !== 1) errs.push(`sezioni ${sc.secs}, attesa 1`);
      errs.push(...await evaluate(`(() => { const e = [], W = innerWidth;
        if (document.documentElement.scrollWidth > W + 0.5) e.push('la pagina scorre in orizzontale');
        const cs = [...document.querySelectorAll('.pj-cards .card')];
        if (cs.length !== 3) e.push('card ' + cs.length + ', attese 3 (la chiusa è nascosta)');
        cs.forEach((x, k) => { const r = x.getBoundingClientRect(); if (r.right > W + 0.5 || r.left < -0.5) e.push('card fuori schermo'); if (k && r.top < cs[k-1].getBoundingClientRect().bottom - 0.5 && r.left <= cs[k-1].getBoundingClientRect().left) e.push('card sovrapposte'); });
        if (!document.querySelector('.pj-cards .lbl')) e.push('manca il chip etichetta');
        const bg = getComputedStyle(document.body).backgroundColor; if (bg !== 'rgb(16, 17, 18)') e.push('tema scuro non applicato: ' + bg);
        return e; })()`));
      for (const want of [1, 1, 1]) {
        await evaluate(`document.querySelector('.pj-cards .card').click()`);
        const got = await info();
        if (got.panels !== want || !got.open) errs.push(`dopo il tocco: ${got.panels} pannelli, drawer ${got.open}, attesi ${want}`);
      }
      const out = await evaluate(`[...document.querySelectorAll('#drawer .pj-panel button, #drawer .pj-panel input, #drawer .pj-panel textarea')].filter(b => b.getBoundingClientRect().right > window.innerWidth + 0.5).map(b => b.id || b.tagName).join()`);
      if (out) errs.push('fuori dallo schermo: ' + out);
      const shot = await c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, `projects-${w}.png`), Buffer.from(shot.data, 'base64'));
      await evaluate(`document.querySelector('#drawer [data-close].btn').click()`);
      if ((await info()).open) errs.push('il drawer non si chiude');
      await evaluate(`document.querySelector('.pj-cards .card').click()`);
      await evaluate(`(() => { const s = document.getElementById('pj-closed'); s.checked = true; s.dispatchEvent(new Event('change')); })()`);
      const after = await info();
      if (after.open || after.panels) errs.push('il cambio filtro lascia il drawer aperto');
      if (await evaluate(`document.querySelectorAll('.pj-cards .card').length`) !== 4) errs.push('con «anche chiuse» attese 4 card');
    }
    if (errs.length) { failed++; console.log(`FAIL projects.html (${w}px): ` + errs.join('; ')); }
    else console.log(`ok projects.html (${w}px): sezioni, card, drawer, tocchi ripetuti, tema scuro`);
  }
  // Link diretto a una issue di un Project (issue 284): #sumisura-7 apre il drawer; id sconosciuto no; chiusura pulisce l'URL; riapertura dallo stesso link.
  for (const [w, hgt, mobile] of [[390, 800, true], [1280, 800, false]]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });
    const errs = [];
    const go = async hash => { const b = c.once('Page.loadEventFired'); await c.send('Page.navigate', { url: 'about:blank' }); await b; const l = c.once('Page.loadEventFired'); await c.send('Page.navigate', { url: `${base}/projects.html${hash}` }); await l; await waitFor(() => evaluate(`document.querySelectorAll('.pj-cards .card').length > 0`)); };
    const info = () => evaluate(`({ panels: document.querySelectorAll('.pj-panel').length, open: !document.getElementById('drawer').hidden, id: document.getElementById('d-id').textContent, hash: location.hash })`);
    await go('#sumisura-8');
    let g = await info();
    if (!g.open || g.panels !== 1 || !/8/.test(g.id)) errs.push(`da URL: ${JSON.stringify(g)}`);
    await evaluate(`document.querySelector('#drawer [data-close].btn').click()`);
    g = await info();
    if (g.open || g.hash) errs.push(`dopo la chiusura: ${JSON.stringify(g)}`);
    await evaluate(`location.hash = '#sumisura-8'`);
    await waitFor(() => evaluate(`!document.getElementById('drawer').hidden`));
    g = await info();
    if (!g.open || g.panels !== 1) errs.push(`riapertura: ${JSON.stringify(g)}`);
    await go('#sumisura-6');
    g = await info();
    if (!g.open || g.panels !== 1) errs.push(`issue chiusa da URL: ${JSON.stringify(g)}`);
    await go('#sumisura-999');
    g = await info();
    if (g.open || g.panels) errs.push(`id sconosciuto apre il drawer: ${JSON.stringify(g)}`);
    if (errs.length) { failed++; console.log(`FAIL projects.html link diretto (${w}px): ` + errs.join('; ')); }
    else console.log(`ok projects.html link diretto (${w}px): apre, chiude e riapre, id sconosciuto ignorato`);
  }
  // Strategia della coda (issue 225): pagina, anteprima = lo stesso selettore di ops-auto, salva con tocchi ripetuti, config invalida rifiutata; 390 e 1280 px.
  for (const [w, hgt, mobile] of [[390, 800, true], [1280, 800, false]]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    fs.rmSync(path.join(tmp, 'queue.json'), { force: true });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/queue.html` });
    await loaded;
    const errs = [];
    if (!await waitFor(() => evaluate(`document.querySelectorAll('#qs-sources .qs-src-row').length > 0 && document.querySelectorAll('#qs-preview li').length > 0`))) errs.push('pagina non caricata');
    else {
      const prev = () => evaluate(`[...document.querySelectorAll('#qs-preview li b')].map(b => b.textContent).join(' ')`);
      const cli = cfgFile => execFileSync(process.execPath, [path.join(__dirname, '..', 'tracker', 'issues.js'), '--order', env.TRACKER_REPO, '--config', cfgFile],
        { encoding: 'utf8', input: execFileSync(process.execPath, [path.join(__dirname, '..', 'tracker', 'issues.js'), '--queue', env.TRACKER_REPO], { encoding: 'utf8', env: { ...process.env, HS_QUEUE_PROJECTS_JSON: pjFile, HS_PROJECTS_FILE: pjList } }).split('\n').filter(Boolean).map(x => 'r ' + x).join('\n'),
        env: { ...process.env, HS_QUEUE_PROJECTS_JSON: pjFile, HS_QUEUE_RR: path.join(tmp, 'none') } }).split('\n').filter(Boolean).slice(0, 10)
        .map(x => /\.md$/.test(x) ? x.split('-')[0] : x.replace(/-(\d+)$/, '#$1')).join(' ');
      errs.push(...await evaluate(`(() => { const e = [], W = innerWidth;
        if (document.documentElement.scrollWidth > W + 0.5) e.push('la pagina scorre in orizzontale');
        for (const x of document.querySelectorAll('#qs-form input, #qs-form button')) { const r = x.getBoundingClientRect(); if (r.right > W + 0.5 || r.left < -0.5) e.push('fuori schermo: ' + (x.id || x.name)); if (r.height < 20) e.push('troppo basso: ' + (x.id || x.name)); }
        if (getComputedStyle(document.body).backgroundColor !== 'rgb(16, 17, 18)') e.push('tema scuro non applicato');
        return e; })()`));
      const rot = await prev();
      fs.writeFileSync(path.join(tmp, 'rot.json'), JSON.stringify({ strategy: 'rotation', urgent_first: false, focus: '', sources: {} }));
      if (rot !== cli(path.join(tmp, 'rot.json'))) errs.push('anteprima rotazione diversa da ops-auto: ' + rot + ' | ' + cli(path.join(tmp, 'rot.json')));
      // Focus sul Project: l'anteprima cambia senza salvare, e coincide col selettore di ops-auto.
      await evaluate(`(() => { const r = document.querySelector('input[name=strategy][value=focus]'); r.click(); const f = [...document.querySelectorAll('input[name=focus]')].find(x => x.value !== 'home-server'); f.click(); })()`);
      const chosen = await evaluate(`document.querySelector('input[name=focus]:checked').value`);
      await waitFor(async () => (await prev()) !== rot);
      const foc = await prev();
      fs.writeFileSync(path.join(tmp, 'foc.json'), JSON.stringify({ strategy: 'focus', urgent_first: false, focus: chosen, sources: {} }));
      if (foc === rot) errs.push('l’anteprima non cambia con la strategia');
      if (foc !== cli(path.join(tmp, 'foc.json'))) errs.push('anteprima focus diversa da ops-auto: ' + foc + ' | ' + cli(path.join(tmp, 'foc.json')));
      if (fs.existsSync(path.join(tmp, 'queue.json'))) errs.push('l’anteprima ha salvato la configurazione');
      for (let k = 0; k < 3; k++) await evaluate(`document.querySelector('#qs-form button[type=submit]').click()`);
      if (!await waitFor(() => fs.existsSync(path.join(tmp, 'queue.json')))) errs.push('configurazione non salvata');
      else if (JSON.parse(fs.readFileSync(path.join(tmp, 'queue.json'), 'utf8')).strategy !== 'focus') errs.push('strategia salvata sbagliata');
      await waitFor(() => evaluate(`document.getElementById('qs-ok').textContent === 'Salvato'`));
      // Peso fuori limite: errore a schermo, file invariato.
      const before = fs.readFileSync(path.join(tmp, 'queue.json'), 'utf8');
      await evaluate(`(() => { document.querySelector('input[name=strategy][value=weighted]').click(); const w = document.querySelector('#qs-sources input[type=number]'); w.value = 9; w.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#qs-form button[type=submit]').click(); })()`);
      if (!await waitFor(() => evaluate(`document.getElementById('qs-msg').textContent.length > 0`))) errs.push('nessun errore per il peso 9');
      if (fs.readFileSync(path.join(tmp, 'queue.json'), 'utf8') !== before) errs.push('config invalida salvata');
      const shot = await c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, `queue-${w}.png`), Buffer.from(shot.data, 'base64'));
    }
    if (errs.length) { failed++; console.log(`FAIL queue.html (${w}px): ` + errs.join('; ')); }
    else console.log(`ok queue.html (${w}px): anteprima = selettore di ops-auto, salva, tocchi ripetuti, config invalida rifiutata`);
  }
  // Card Rilasci (issue 209): annuncio con novità in italiano, «Rimanda» con tocchi ripetuti = una sola richiesta; 390 e 1280 px, tema scuro.
  for (const [w, hgt, mobile] of [[390, 800, true], [1280, 800, false]]) {
    await c.send("Emulation.setDeviceMetricsOverride", { width: w, height: hgt, deviceScaleFactor: 1, mobile });
    await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    fs.rmSync(path.join(tmp, "rreq", "sumisura.req.json"), { force: true });
    const loaded = c.once("Page.loadEventFired");
    await c.send("Page.navigate", { url: `${base}/projects.html` });
    await loaded;
    const ready = await waitFor(() => evaluate(`document.querySelectorAll(".rel-card").length > 0`));
    const errs = [];
    if (!ready) errs.push("card non caricata");
    else {
      errs.push(...await evaluate(`(() => { const e = [], W = innerWidth, c = document.querySelector(".rel-card"), t = c.textContent;
        if (document.documentElement.scrollWidth > W + 0.5) e.push("la pagina scorre in orizzontale");
        const r = c.getBoundingClientRect(); if (r.right > W + 0.5 || r.left < -0.5) e.push("card fuori schermo");
        if (!/v0[.]5[.]0/.test(t) || !/Esce tra 2[0-9] h/.test(t)) e.push("versione o ore mancanti: " + t.slice(0, 80));
        if (!/Novità/.test(t) || !/Correzioni/.test(t) || !/cv: nuovo modello/.test(t) || /abc1234/.test(t)) e.push("novità non leggibili");
        if (!/Ultima release: v0[.]4[.]0 del 1 ottobre 2026/.test(t)) e.push("ultima release: " + t);
        if (c.querySelector("b")) e.push("HTML del changelog interpretato");
        const b = c.querySelector("#rel-postpone-sumisura"); if (!b) e.push("manca Rimanda"); else { const q = b.getBoundingClientRect(); if (q.right > W + 0.5) e.push("Rimanda fuori schermo"); }
        if (getComputedStyle(document.body).backgroundColor !== "rgb(16, 17, 18)") e.push("tema scuro non applicato");
        return e; })()`));
      await evaluate(`(() => { const b = document.querySelector("#rel-postpone-sumisura"); b.click(); b.click(); b.click(); })()`);
      await sleep(2500);
      const files = fs.readdirSync(path.join(tmp, "rreq"));
      if (files.join() !== "sumisura.req.json") errs.push("richieste: " + files.join());
      const after = await evaluate(`({ cards: document.querySelectorAll(".rel-card").length, dis: document.querySelector("#rel-postpone-sumisura").disabled, txt: document.querySelector(".rel-card").textContent })`);
      if (after.cards !== 1) errs.push("card duplicate: " + after.cards);
      if (!after.dis || !/Richiesta di rinvio inviata/.test(after.txt)) errs.push("dopo Rimanda il bottone resta attivo o manca il testo");
      const shot = await c.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(SHOTS, `rilasci-${w}.png`), Buffer.from(shot.data, "base64"));
    }
    if (errs.length) { failed++; console.log(`FAIL rilasci (${w}px): ` + errs.join("; ")); }
    else console.log(`ok rilasci (${w}px): annuncio, novità, Rimanda con tocchi ripetuti, tema scuro`);
  }
  await c.send('Emulation.setEmulatedMedia', { features: [] });
  // Impostazioni (issue 223): essenziali in vista, «Avanzate» chiusa, «?» un pannello alla volta, salvataggio di un valore avanzato.
  for (const k of CASES.filter(k => !k.active && !k.open)) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: k.width, height: k.height, deviceScaleFactor: 1, mobile: k.mobile });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/settings.html` });
    await loaded;
    const ready = await waitFor(() => evaluate(`!!document.querySelector('#st-adv')`));
    if (!ready) { failed++; console.log(`FAIL impostazioni (${k.name}): pagina non caricata`); continue; }
    const errs = [];
    const st = () => evaluate(`({ adv: document.querySelector('#st-adv').open, vis: [...document.querySelectorAll('.st-row')].filter(r => r.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })).length,
      open: [...document.querySelectorAll('.st-panel')].filter(p => !p.hidden).length, over: document.documentElement.scrollWidth > innerWidth })`);
    let g = await st();
    if (g.adv) errs.push('Avanzate aperta di default');
    if (g.vis < 1 || g.vis > 6) errs.push(`essenziali in vista: ${g.vis}`);
    const tap = i => evaluate(`document.querySelectorAll('.st-help')[${i}].click(), 0`);
    await tap(0); g = await st(); if (g.open !== 1) errs.push('«?» non apre il pannello');
    await tap(0); g = await st(); if (g.open !== 0) errs.push('secondo tocco non chiude');
    await tap(0); await tap(1); g = await st(); if (g.open !== 1) errs.push('due pannelli aperti insieme');
    await evaluate(`document.body.click(), 0`); g = await st(); if (g.open !== 0) errs.push('tocco fuori non chiude');
    await evaluate(`document.querySelector('#st-adv > summary').click(), 0`); g = await st();
    if (!g.adv || g.vis <= 6) errs.push('Avanzate non si apre');
    if (g.over) errs.push('scroll orizzontale');
    await evaluate(`document.querySelector('#st-adv > summary').click(), 0`); g = await st();
    if (g.adv) errs.push('Avanzate non si richiude');
    await evaluate(`document.querySelector('#st-adv > summary').click(), 0`);
    await fill('#st-HS_BACKLOG_STALE_DAYS', '45');
    await evaluate(`document.querySelector('#st-form .st-actions button').click(), 0`);
    const saved = await waitFor(() => evaluate(`!!document.querySelector('#row-HS_BACKLOG_STALE_DAYS .st-dot')`));
    if (!saved) errs.push('valore avanzato non salvato (manca il pallino): ' + await evaluate(`document.querySelector('#st-msg').textContent + '|' + document.querySelector('#st-ok').textContent + '|' + document.querySelector('#st-HS_BACKLOG_STALE_DAYS').value`));
    g = await st(); if (!g.adv) errs.push('Avanzate si chiude dopo il salvataggio');
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, `impostazioni-${k.name}.png`), Buffer.from(shot.data, 'base64'));
    await evaluate(`fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: { HS_BACKLOG_STALE_DAYS: null } }) }).then(() => 0)`);
    if (errs.length) { failed++; console.log(`FAIL impostazioni (${k.name}):`); for (const e of errs) console.log('    ' + e); }
    else console.log(`ok impostazioni (${k.name}): essenziali, «?» uno alla volta, Avanzate, salvataggio`);
  }
  // Barre dei limiti (issue 179): due segni sulla barra settimanale (programmati 50%, manuale 80%), età del dato; un solo segno se uguali.
  for (const k of CASES.filter(k => !k.active && !k.open)) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: k.width, height: k.height, deviceScaleFactor: 1, mobile: k.mobile });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/auto.html` });
    await loaded;
    const ready = await waitFor(() => evaluate(`typeof renderGates === 'function' && !!document.querySelector('#au-limits')`));
    if (!ready) { failed++; console.log(`FAIL limiti (${k.name}): pagina /auto.html non caricata`); continue; }
    const got = await evaluateRead(`(() => { const now = Math.floor(Date.now() / 1000), out = {};
      const run = (quotaManualMax, at) => { renderGates({ repo: { dirty: false, freeAt: 0 }, counts: {}, gates: { quotaMax: 50, quotaManualMax, perRun: 1,
        week: { util: 30, reset: now + 86400, at }, five: null } });
        const t = document.querySelector('#au-limits .lim'), m = [...t.querySelectorAll('.lim-max')];
        const tr = t.querySelector('.lim-track').getBoundingClientRect();
        return { n: m.length, pos: m.map(e => Math.round((e.getBoundingClientRect().left - tr.left) / tr.width * 100)),
          sub: t.querySelector('.lim-sub').textContent, stale: !!t.querySelector('.lim-stale'), inside: t.getBoundingClientRect().right <= innerWidth }; };
      out.two = run(80, now - 60); out.same = run(50, now - 60); out.old = run(80, now - 3 * 3600); return out; })()`);
    const errs = [];
    if (got.two.n !== 2 || Math.abs(got.two.pos[0] - 50) > 2 || Math.abs(got.two.pos[1] - 80) > 2) errs.push(`segni 50/80: ${JSON.stringify(got.two.pos)}`);
    if (!/programmati 50%.*manuale 80%/.test(got.two.sub) || !/dato delle \d\d:\d\d/.test(got.two.sub)) errs.push(`testo: «${got.two.sub}»`);
    if (got.same.n !== 1) errs.push(`limiti uguali: ${got.same.n} segni, atteso 1`);
    if (!got.old.stale || !/dato .* fa/.test(got.old.sub)) errs.push(`dato vecchio non segnalato: «${got.old.sub}»`);
    if (!got.two.inside) errs.push('barra fuori dallo schermo');
    if (errs.length) { failed++; console.log(`FAIL limiti (${k.name}):`); for (const e of errs) console.log('    ' + e); }
    else console.log(`ok limiti (${k.name}): due segni 50/80, un solo segno se uguali, età del dato`);
  }
  // Consumo per backend (issue 253): una riga per backend con run, token e costo; nascosta senza dati; nessun overflow.
  for (const k of CASES.filter(k => !k.active && !k.open)) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: k.width, height: k.height, deviceScaleFactor: 1, mobile: k.mobile });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/auto.html` });
    await loaded;
    const ready = await waitFor(() => evaluate(`typeof renderBackends === 'function' && !!document.querySelector('#au-backends')`));
    if (!ready) { failed++; console.log(`FAIL consumo per backend (${k.name}): pagina /auto.html non caricata`); continue; }
    const got = await evaluateRead(`(() => { const el = document.querySelector('#au-backends');
      renderBackends({ backends: { days: 7, by: { headless: { runs: 3, turns: 40, cost: 1.5, in: 1200, out: 90000, cacheRead: 2500000, cacheWrite: 30000 } } } });
      const shown = { hidden: el.hidden, rows: el.querySelectorAll('.irow').length, text: el.textContent, inside: el.getBoundingClientRect().right <= innerWidth };
      renderBackends({ backends: { days: 7, by: {} } }); shown.emptyHidden = el.hidden; return shown; })()`);
    const errs = [];
    if (got.hidden || got.rows !== 1) errs.push(`righe: ${got.rows}, nascosta: ${got.hidden}`);
    if (!/Claude Code/.test(got.text) || !/3 run/.test(got.text) || !/2\.5M/.test(got.text) || !/\$1\.50/.test(got.text)) errs.push(`testo: «${got.text}»`);
    if (!got.emptyHidden) errs.push('senza dati la sezione resta visibile');
    if (!got.inside) errs.push('sezione fuori dallo schermo');
    if (errs.length) { failed++; console.log(`FAIL consumo per backend (${k.name}):`); for (const e of errs) console.log('    ' + e); }
    else console.log(`ok consumo per backend (${k.name}): una riga per backend, token e costo, nascosta senza dati`);
  }
  // Coda con voci in attesa (issue 259): la prima voce è «la prossima», quelle con PR/pausa/senza CI stanno sotto, grigie, con il motivo; nessun overflow.
  for (const k of CASES.filter(k => !k.active && !k.open)) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: k.width, height: k.height, deviceScaleFactor: 1, mobile: k.mobile });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/auto.html` });
    await loaded;
    const ready = await waitFor(() => evaluate(`typeof renderQueue === 'function' && !!document.querySelector('#au-queue')`));
    if (!ready) { failed++; console.log(`FAIL coda in attesa (${k.name}): pagina /auto.html non caricata`); continue; }
    const got = await evaluateRead(`(() => { const el = document.querySelector('#au-queue');
      renderQueue({ code: 'idle', repo: { dirty: false, freeAt: 0 }, counts: {}, gates: {}, queueTotal: 1, queue: [{ id: '200', title: 'Una issue', priority: 'none', monitor: false }],
        waiting: [{ id: 'library#8', title: 'In attesa di merge', why: 'pr', pr: '12' }, { id: 'beta#3', title: 'Senza CI', why: 'ci' }, { id: 'beta#4', title: 'Pausa', why: 'hold' }] });
      return { next: el.querySelectorAll('.queue:not(.q-wait) .next').length, nextText: el.querySelector('.next').textContent,
        wait: [...el.querySelectorAll('.q-wait li')].map(l => l.textContent), link: el.querySelector('.q-wait a.ilink').getAttribute('href'), go: el.querySelectorAll('.q-wait .q-go').length, inside: el.getBoundingClientRect().right <= innerWidth && document.documentElement.scrollWidth <= innerWidth }; })()`);
    const errs = [];
    if (got.next !== 1 || /library/.test(got.nextText)) errs.push(`prossima: ${got.next} «${got.nextText}»`);
    if (got.wait.length !== 3 || !/merge #12/.test(got.wait[0]) || !/aspetta la CI/.test(got.wait[1]) || !/in pausa/.test(got.wait[2])) errs.push(`in attesa: ${JSON.stringify(got.wait)}`);
    if (got.link !== '/projects.html#library-8') errs.push(`link issue di Project: ${got.link}`);
    if (got.go) errs.push('le voci in attesa hanno «Avvia»');
    if (!got.inside) errs.push('fuori dallo schermo');
    if (errs.length) { failed++; console.log(`FAIL coda in attesa (${k.name}):`); for (const e of errs) console.log('    ' + e); }
    else console.log(`ok coda in attesa (${k.name}): la prossima non è in attesa, motivo mostrato, nessun overflow`);
  }
  // Coda vuota (issue 269): senza voci e senza `waiting` la sezione non mostra «null»/«undefined».
  for (const k of CASES.filter(k => !k.active && !k.open)) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: k.width, height: k.height, deviceScaleFactor: 1, mobile: k.mobile });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/auto.html` });
    await loaded;
    const ready = await waitFor(() => evaluate(`typeof renderQueue === 'function' && !!document.querySelector('#au-queue')`));
    if (!ready) { failed++; console.log(`FAIL coda vuota (${k.name}): pagina /auto.html non caricata`); continue; }
    let got;
    for (let i = 0; i < 5 && !got; i++) { if (i) await sleep(500); got = await evaluate(`(() => { const el = document.querySelector('#au-queue');
      const st = { code: 'idle', repo: { dirty: false, freeAt: 0 }, counts: {}, gates: {}, queueTotal: 0, queue: [] };
      renderQueue(st); const a = el.textContent; renderQueue({ ...st, waiting: [] }); const b = el.textContent;
      return { a, b, inside: document.documentElement.scrollWidth <= innerWidth }; })()`); }
    if (!got) { failed++; console.log(`FAIL coda vuota (${k.name}): la pagina non ha risposto`); continue; }
    const bad = t => /null|undefined/.test(t) || !/Niente in coda/.test(t);
    if (bad(got.a) || bad(got.b) || !got.inside) { failed++; console.log(`FAIL coda vuota (${k.name}): «${got.a}» «${got.b}» overflow ${!got.inside}`); }
    else console.log(`ok coda vuota (${k.name}): «Niente in coda» senza null/undefined`);
  }
  // Segnali (issue 298): tutti i segnali, quelli sopra soglia in cima; «Nessun dato» senza file; dettagli al tocco; nessun overflow.
  for (const k of CASES.filter(k => !k.active && !k.open)) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: k.width, height: k.height, deviceScaleFactor: 1, mobile: k.mobile });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/auto.html` });
    await loaded;
    const ready = await waitFor(() => evaluate(`typeof renderSignals === 'function' && !!document.querySelector('#au-signals')`));
    if (!ready) { failed++; console.log(`FAIL segnali (${k.name}): pagina /auto.html non caricata`); continue; }
    const got = await evaluateRead(`(() => { const el = document.querySelector('#au-signals');
      renderSignals({ v: 1, missing: true }); const none = el.textContent;
      renderSignals({ v: 1, generated: new Date().toISOString(), signals: [
        { id: 'sig-errors', over: false, count: 0, threshold: 2 },
        { id: 'sig-retries', over: true, issues: ['12', '34'], count: 2, threshold: 2 },
        { id: 'sig-unknown', over: true },
        { id: 'sig-denied', over: true, count: 5, byTool: { Bash: 5 }, threshold: 3 }] });
      const rows = [...el.querySelectorAll('.sig')];
      const r = { none, ids: rows.map(d => d.dataset.sig), over: rows.map(d => d.classList.contains('over')),
        closed: rows[0].open, links: [...rows[0].querySelectorAll('a.ilink')].map(a => a.getAttribute('href')) };
      rows[0].querySelector('summary').click(); r.openAfter = rows[0].open; rows[0].querySelector('summary').click(); r.closedAgain = !rows[0].open;
      r.inside = document.documentElement.scrollWidth <= innerWidth; return r; })()`);
    const errs = [];
    if (!/Nessun dato/.test(got.none)) errs.push(`senza file: «${got.none}»`);
    if (got.ids.join() !== 'sig-retries,sig-denied,sig-errors' || got.over.join() !== 'true,true,false') errs.push(`ordine: ${got.ids} ${got.over}`);
    if (got.closed || !got.openAfter || !got.closedAgain) errs.push('il tocco non apre/chiude i dettagli');
    if (got.links.join() !== '/#12,/#34') errs.push(`link: ${got.links}`);
    if (!got.inside) errs.push('overflow');
    if (errs.length) { failed++; console.log(`FAIL segnali (${k.name}):`); for (const e of errs) console.log('    ' + e); }
    else console.log(`ok segnali (${k.name}): sopra soglia in cima, «Nessun dato», dettagli al tocco, nessun overflow`);
  }
  // Attività programmate (issue 224): aperta da sola solo la categoria con un errore, le altre si aprono al tocco, nessun overflow.
  for (const k of CASES.filter(k => !k.active && !k.open)) {
    await c.send('Emulation.setDeviceMetricsOverride', { width: k.width, height: k.height, deviceScaleFactor: 1, mobile: k.mobile });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/jobs.html` });
    await loaded;
    const ready = await waitFor(() => evaluate(`document.querySelectorAll('.jb-cat').length === 2`));
    if (!ready) { failed++; console.log(`FAIL attività programmate (${k.name}): pagina non caricata`); continue; }
    const errs = [];
    const st = () => evaluate(`({ open: [...document.querySelectorAll('.jb-cat')].map(d => d.id + ':' + d.open).join(), vis: [...document.querySelectorAll('.jb-job')].filter(r => r.checkVisibility()).length, over: document.documentElement.scrollWidth > innerWidth, txt: document.querySelector('.jb-cat summary').textContent })`);
    let g = await st();
    if (g.open !== 'backup:true,sistema:false') errs.push(`aperte: ${g.open}`);
    if (g.vis !== 3) errs.push(`attività in vista: ${g.vis}`);
    if (!/1 con errore/.test(g.txt)) errs.push(`titolo: ${g.txt}`);
    await evaluate(`document.querySelectorAll('.jb-cat summary')[1].click(), 0`); g = await st();
    if (g.vis !== 5 || g.over) errs.push(`dopo il tocco: in vista ${g.vis}, overflow ${g.over}`);
    await evaluate(`document.querySelectorAll('.jb-cat summary')[1].click(), 0`); g = await st();
    if (g.vis !== 3) errs.push(`dopo il secondo tocco: in vista ${g.vis}`);
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, `attivita-${k.name}.png`), Buffer.from(shot.data, 'base64'));
    if (errs.length) { failed++; console.log(`FAIL attività programmate (${k.name}):`); for (const e of errs) console.log('    ' + e); }
    else console.log(`ok attività programmate (${k.name}): solo la categoria con errori aperta, tocchi ripetuti, nessun overflow`);
  }
  // Domande a flashcard (issue 352): layout at phone widths, then the flow: Salta/Indietro, Rispondi (double tap = one send),
  // Fatto, 409 on a changed issue, «Non ancora», a Project card through the write queue, end of the queue.
  {
    const wdir = env.TRACKER_PROJECTS_WRITES;
    for (const f of fs.readdirSync(wdir)) fs.rmSync(path.join(wdir, f));
    const nav = async () => { const l = c.once('Page.loadEventFired'); await c.send('Page.navigate', { url: `${base}/domande.html` }); await l; await waitFor(() => evaluate(`!!document.querySelector('.dq-card')`)); };
    const errs = [];
    // own questions only: the other issues of the fixture lose theirs
    const odir = path.join(env.TRACKER_REPO, 'issues/open');
    for (const f of fs.readdirSync(odir)) { const t = fs.readFileSync(path.join(odir, f), 'utf8'); if (/\(HITL\)|^Blocked on: user/m.test(t)) fs.rmSync(path.join(odir, f)); }
    fs.writeFileSync(path.join(odir, '030-domande-prova.md'), '# Domande prova\n\nOpened: 2026-01-01\nBlocked on: user (passi)\nStatus: in-progress\n\nContesto <b>lungo</b>.\n\n## Esecuzione\n- [ ] (HITL) Primo? (perché)\n- [ ] (HITL) Secondo? (perché)\n- [ ] (HITL) Terzo? (perché)\n');
    fs.writeFileSync(path.join(odir, '031-solo-prosa.md'), '# Solo prosa\n\nOpened: 2026-01-01\nBlocked on: user (domanda)\nStatus: todo\n\nUna domanda in prosa.\n');
    for (const w of [390, 360, 340]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: true });
      await nav();
      const g = await evaluate(`({ over: document.documentElement.scrollWidth > innerWidth, n: document.getElementById('dq-count').textContent, btns: [...document.querySelectorAll('.dq-actions .btn')].filter(b => !b.hidden).map(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width > 40; }).every(Boolean) })`);
      if (g.over || !g.btns || g.n !== '1 di 5') errs.push(`${w}px: ${JSON.stringify(g)}`);
      fs.writeFileSync(path.join(SHOTS, `domande-${w}.png`), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await nav();
    const st = () => evaluate(`({ n: document.getElementById('dq-count').textContent, t: (document.querySelector('.dq-title') || {}).textContent, q: (document.getElementById('dq-q') || {}).textContent, out: (document.getElementById('dq-out') || {}).textContent })`);
    const click = id => evaluate(`document.getElementById('${id}').click()`);
    const waitCard = n => waitFor(async () => (await st()).n === n, 6000);
    let s = await st();
    if (s.t !== 'Domande prova' || !/^\(HITL\) Primo/.test(s.q)) errs.push('prima carta: ' + JSON.stringify(s));
    if (await evaluate(`document.querySelector('.dq-ctx').textContent`) !== 'Contesto <b>lungo</b>.') errs.push('contesto non mostrato come testo');
    await click('dq-skip'); await waitCard('2 di 5');
    s = await st();
    if (!/^\(HITL\) Secondo/.test(s.q)) errs.push('seconda carta: ' + JSON.stringify(s));
    await click('dq-back'); if (!await waitCard('1 di 5')) errs.push('Indietro non torna');
    await click('dq-skip'); await waitCard('2 di 5');
    // risposta vuota rifiutata; doppio tocco = un solo invio
    await click('dq-answer');
    if (!/Scrivi/.test((await st()).out)) errs.push('risposta vuota non rifiutata');
    await evaluate(`document.getElementById('dq-text').value = 'la seconda'; document.getElementById('dq-answer').click(); document.getElementById('dq-answer').click()`);
    if (!await waitCard('3 di 5')) errs.push('dopo Rispondi non passa alla successiva');
    const issue030 = () => evaluate(`fetch('/api/issues/030', { credentials: 'same-origin' }).then(r => r.json())`);
    let d = await issue030();
    if (d.commentList.length !== 1 || !/Secondo/.test(d.commentList[0].text) || !/la seconda/.test(d.commentList[0].text)) errs.push('doppio tocco: ' + d.commentList.length + ' commenti');
    // Fatto sul terzo passo (la versione è stata aggiornata dalla risposta precedente: niente 409)
    await click('dq-done');
    if (!await waitCard('4 di 5')) errs.push('Fatto non passa alla successiva: ' + JSON.stringify(await st()));
    d = await issue030();
    if (!/\[x\] \(HITL\) Terzo/.test(d.desc) || d.commentList.length !== 2) errs.push('Fatto non registrato');
    // carta senza passo: niente Fatto; 409 se la issue cambia sotto la carta
    if (await evaluate(`document.getElementById('dq-done').hidden`) !== true) errs.push('Fatto su una carta senza passo');
    const f031 = path.join(odir, '031-solo-prosa.md');
    fs.writeFileSync(f031, fs.readFileSync(f031, 'utf8') + '\nAggiunta.\n');
    await evaluate(`document.getElementById('dq-text').value = 'x'; document.getElementById('dq-answer').click()`);
    await waitFor(async () => /cambiata/.test((await st()).out), 5000);
    if (!/cambiata/.test((await st()).out)) errs.push('409 senza messaggio: ' + JSON.stringify(await st()));
    if (!await waitCard('1 di 3')) errs.push('ricarico dopo 409: ' + JSON.stringify(await st()));
    // «Non ancora» nasconde la carta e la tiene fuori dopo il ricarico
    await click('dq-later'); await waitCard('2 di 3');
    const snz = (() => { try { return JSON.parse(fs.readFileSync(path.join(env.TRACKER_STATE, 'questions-snooze.json'), 'utf8')); } catch { return {}; } })();
    if (Object.keys(snz).length !== 1) errs.push('snooze non salvato');
    await click('dq-skip'); await waitCard('3 di 3');
    // carta del Project: legge la issue, risponde
    s = await st();
    if (!/sumisura#9|Serve il tuo ok/.test(s.t)) { await click('dq-skip'); await waitCard('3 di 3'); }
    let rq; await waitFor(async () => { const f = fs.readdirSync(wdir).filter(x => x.endsWith('.req.json')); if (f.length) rq = JSON.parse(fs.readFileSync(path.join(wdir, f[0]), 'utf8')); return !!rq; }, 5000);
    if (!rq || rq.action !== 'read' || rq.number !== 9) errs.push('read non in coda: ' + JSON.stringify(rq));
    else {
      fs.writeFileSync(path.join(wdir, rq.id + '.res.json'), JSON.stringify({ id: rq.id, ok: true, msg: 'letto', steps: ['(HITL) scegli A o B'], last: { by: 'bot', text: 'ciao <b>x</b>' }, needs_owner: true }));
      await waitFor(async () => /scegli A/.test((await st()).q || ''), 8000);
      await evaluate(`document.getElementById('dq-text').value = 'A'; document.getElementById('dq-answer').click(); document.getElementById('dq-answer').click()`);
      let aq; await waitFor(() => { const f = fs.readdirSync(wdir).filter(x => x.endsWith('.req.json') && x !== rq.id + '.req.json'); if (f.length) aq = JSON.parse(fs.readFileSync(path.join(wdir, f[0]), 'utf8')); return !!aq; }, 5000);
      await sleep(500);
      const nreq = fs.readdirSync(wdir).filter(x => x.endsWith('.req.json') && x !== rq.id + '.req.json').length;
      if (!aq || aq.action !== 'answer' || JSON.stringify(aq.answers) !== JSON.stringify([{ text: '(HITL) scegli A o B', kind: 'answer', note: 'A' }]) || nreq !== 1) errs.push('answer Project: ' + nreq + ' ' + JSON.stringify(aq));
      else {
        fs.writeFileSync(path.join(wdir, aq.id + '.res.json'), JSON.stringify({ id: aq.id, ok: true, msg: 'fatto' }));
        await waitFor(() => evaluate(`!!document.getElementById('dq-reload')`), 8000);
        const end = await evaluate(`document.querySelector('.dq-end').textContent`);
        if (!/Hai finito/.test(end) || !/Risposte date: 3/.test(end)) errs.push('fine coda: ' + end);
      }
    }
    fs.writeFileSync(path.join(SHOTS, 'domande-fine.png'), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    if (errs.length) { failed++; console.log('FAIL domande:'); for (const e of errs) console.log('    ' + e); }
    else console.log('ok domande.html: flashcard, Salta/Indietro, doppio tocco, Fatto, 409, Non ancora, carta Project, fine coda');
  }

  // Issue 353: suggested answer on the card: Accetta sends it as is, Modifica fills the box, Lascia in sospeso hides the card.
  {
    const errs = [];
    const odir = path.join(env.TRACKER_REPO, 'issues/open'), sd = env.TRACKER_SUGGESTIONS;
    fs.mkdirSync(sd, { recursive: true });
    for (const f of fs.readdirSync(odir)) { const t = fs.readFileSync(path.join(odir, f), 'utf8'); if (/\(HITL\)|^Blocked on: user/m.test(t)) fs.rmSync(path.join(odir, f)); }
    for (const [n, t] of [['040', 'Suggerita uno'], ['041', 'Suggerita due'], ['042', 'Suggerita tre']])
      fs.writeFileSync(path.join(odir, n + '-' + t.toLowerCase().replace(/ /g, '-') + '.md'), '# ' + t + '\n\nOpened: 2026-01-01\nBlocked on: user (passo)\nStatus: in-progress\n\n## Esecuzione\n- [ ] (HITL) ' + t + '? (perché)\n');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true });
    const nav = async () => { const l = c.once('Page.loadEventFired'); await c.send('Page.navigate', { url: base + '/domande.html' }); await l; await waitFor(() => evaluate("!!document.querySelector('.dq-card')")); };
    await nav();
    const cards = await evaluate("fetch('/api/questions', { credentials: 'same-origin' }).then(r => r.json()).then(j => j.cards.filter(x => x.kind === 'local').map(x => ({ t: x.title, h: x.hash })))");
    for (const x of cards) fs.writeFileSync(path.join(sd, x.h + '.json'), JSON.stringify({ answer: 'Procedi con ' + x.t + ' <b>', why: 'Perché sì.', model: 'sonnet', at: 1 }));
    await nav();
    const title = () => evaluate("(document.querySelector('.dq-title') || {}).textContent");
    for (let i = 0; i < 6 && !/^Suggerita/.test(await title()); i++) { await evaluate("document.getElementById('dq-skip').click()"); await sleep(300); }
    const view = () => evaluate("({ sg: (document.getElementById('dq-sugg') || {}).textContent, later: document.getElementById('dq-later').textContent, over: document.documentElement.scrollWidth > innerWidth, t: document.getElementById('dq-text').value })");
    const v = await view();
    if (!/Risposta consigliata \(suggerita da Sonnet\)/.test(v.sg || '') || !/Procedi con Suggerita .* <b>/.test(v.sg) || !/Perché sì\./.test(v.sg)) errs.push('suggerimento non mostrato come testo: ' + JSON.stringify(v));
    if (v.later !== 'Lascia in sospeso' || v.over || v.t) errs.push('carta con suggerimento: ' + JSON.stringify(v));
    fs.writeFileSync(path.join(SHOTS, 'domande-suggerita.png'), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    const first = await title();
    await evaluate("document.getElementById('dq-edit').click()");
    if (await evaluate("document.getElementById('dq-text').value") !== 'Procedi con ' + first + ' <b>') errs.push('Modifica non precompila il box');
    await evaluate("document.getElementById('dq-later').click()"); // Lascia in sospeso
    await waitFor(async () => (await title()) !== first, 6000);
    const second = await title();
    await evaluate("document.getElementById('dq-accept').click(); document.getElementById('dq-accept').click()");
    await waitFor(async () => (await title()) !== second, 6000);
    await sleep(400);
    const f2 = fs.readdirSync(odir).find(x => x.includes(second.toLowerCase().replace(/ /g, '-')));
    const body = f2 ? fs.readFileSync(path.join(odir, f2), 'utf8') : '';
    const n = (body.match(/Procedi con /g) || []).length;
    if (n !== 1 || !/^### \d{4}-\d{2}-\d{2} \d{2}:\d{2} /m.test(body) || !/- \[x\] \(HITL\) Suggerita due/.test(body)) errs.push('Accetta: commento ' + n + ' volte: ' + body.slice(-300));
    if (errs.length) { failed++; console.log('FAIL domande suggerite:'); for (const e of errs) console.log('    ' + e); }
    else console.log('ok domande.html: risposta suggerita (testo, Accetta una volta, Modifica, Lascia in sospeso)');
  }
  // Mail (issue 015): da collegare (script, passi, URL), Salva con tocchi ripetuti, poi collegato (indirizzo +edge, prova una volta sola); nessun overflow.
  for (const k of CASES.filter(k => !k.active && !k.open)) {
    const ms = env.TRACKER_MAIL_SETUP, mst = env.TRACKER_MAIL_STATUS;
    fs.rmSync(ms, { recursive: true, force: true }); fs.rmSync(mst, { recursive: true, force: true });
    fs.mkdirSync(ms); fs.mkdirSync(mst);
    fs.writeFileSync(path.join(mst, 'edge-mail.gs'), "var SECRET = 'abc';\nfunction doPost(e) {}\n");
    await c.send('Emulation.setDeviceMetricsOverride', { width: k.width, height: k.height, deviceScaleFactor: 1, mobile: k.mobile });
    let loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/mail.html` });
    await loaded;
    const errs = [];
    const view = () => evaluate(`({ st: document.querySelector('#ml-state').textContent, setup: !document.querySelector('#ml-setup').hidden, use: !document.querySelector('#ml-use').hidden,
      steps: document.querySelectorAll('#ml-new:not([hidden]) li').length, up: document.querySelectorAll('#ml-up:not([hidden]) li').length, h1: document.querySelector('#ml-copy-h').textContent, over: document.documentElement.scrollWidth > innerWidth, alias: document.querySelector('#ml-alias').textContent,
      test: document.querySelector('#ml-test').disabled, tst: document.querySelector('#ml-test-st').textContent, err: document.querySelector('#ml-msg').textContent })`);
    if (!await waitFor(async () => /Da collegare/.test((await view()).st))) errs.push('stato iniziale: ' + JSON.stringify(await view()));
    let v = await view();
    if (!v.setup || v.steps !== 7 || v.up || v.use || v.over) errs.push('da collegare: ' + JSON.stringify(v));
    await evaluate(`document.querySelector('#ml-setup details').open = true, 0`);
    if ((await view()).over) errs.push('script aperto: scroll orizzontale');
    fs.writeFileSync(path.join(SHOTS, `mail-setup-${k.name}.png`), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await fill('#ml-url', 'https://script.google.com/macros/s/AKfycbx_abcdefghijklmnopqrstuvwxyz/exec');
    await evaluate(`(() => { const b = document.querySelector('#ml-form button[type=submit]'); b.click(); b.click(); return 0; })()`);
    if (!await waitFor(async () => /Salvato/.test((await view()).st))) errs.push('dopo Salva: ' + JSON.stringify(await view()));
    if (!fs.existsSync(path.join(ms, 'url.json'))) errs.push('url.json non scritto');
    if ((await view()).setup) errs.push('passi ancora in vista dopo Salva');
    const now = Math.floor(Date.now() / 1000) + 5;
    fs.writeFileSync(path.join(mst, 'status.json'), JSON.stringify({ at: now, ok: true, lastOk: now, alias: 'nome.lungo.cognome+edge@gmail.com', accepted: 3, rejectedCount: 1,
      rejected: [{ at: now, from: 'x@evil.example', reason: 'mittente non in lista' }] }));
    // Issue 415: linked and answering but the copy is back (newer template) = «Aggiorna lo script», the +edge part stays.
    loaded = c.once('Page.loadEventFired');
    await c.send('Page.reload', {});
    await loaded;
    if (!await waitFor(async () => /script più nuovo/.test((await view()).st))) errs.push('aggiorna: ' + JSON.stringify(await view()));
    v = await view();
    if (!v.setup || v.steps || v.up !== 5 || !/nuovo/.test(v.h1) || !v.use || v.over) errs.push('aggiorna: ' + JSON.stringify(v));
    fs.writeFileSync(path.join(SHOTS, `mail-aggiorna-${k.name}.png`), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    fs.rmSync(path.join(mst, 'edge-mail.gs'));
    loaded = c.once('Page.loadEventFired');
    await c.send('Page.reload', {});
    await loaded;
    if (!await waitFor(async () => /Collegato ·/.test((await view()).st))) errs.push('collegato: ' + JSON.stringify(await view()));
    v = await view();
    if (!v.use || v.setup || v.alias !== 'nome.lungo.cognome+edge@gmail.com' || v.over) errs.push('collegato: ' + JSON.stringify(v));
    await evaluate(`(() => { const b = document.querySelector('#ml-test'); b.click(); b.click(); b.click(); return 0; })()`);
    if (!await waitFor(async () => /Richiesta inviata/.test((await view()).tst))) errs.push('prova: ' + JSON.stringify(await view()));
    v = await view();
    if (!v.test || v.err) errs.push('prova: bottone attivo o errore dopo tocchi ripetuti: ' + JSON.stringify(v));
    fs.writeFileSync(path.join(SHOTS, `mail-collegato-${k.name}.png`), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    if (errs.length) { failed++; console.log(`FAIL mail (${k.name}):`); for (const e of errs) console.log('    ' + e); }
    else console.log(`ok mail (${k.name}): passi, Salva con tocchi ripetuti, collegato con +edge, prova una volta sola, nessun overflow`);
  }
  c.close();
  return failed ? 1 : 0;
}

main().then(code => process.exit(code), e => { console.log(`FAIL setup: ${e.message}`); process.exit(2); });
