#!/usr/bin/env node
// UI test of the dashboard history charts (issue 338): serves debian/dashboard-web with a fake
// history.jsonl in headless Chromium (DevTools protocol over Node's WebSocket, like tracker-ui.js) and
// checks that the SVG charts appear with a full history, with one sample and with none, at phone and
// desktop widths without horizontal overflow, and that the 7-day button works.
// Exit 0 ok, 1 failures, 77 Chromium not installed (skipped).
'use strict';
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = ['chromium', 'chromium-browser', 'google-chrome'].find(b => {
  try { execFileSync('sh', ['-c', `command -v ${b}`], { stdio: 'ignore' }); return true; } catch { return false; }
});
if (!CHROME) { console.log('skip: chromium non installato (apt-get install chromium)'); process.exit(77); }

const WEB = path.resolve(__dirname, '..', 'debian', 'dashboard-web');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-charts-'));
const kids = [];
process.on('exit', () => { for (const k of kids) try { k.kill('SIGKILL'); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = Math.floor(Date.now() / 1000);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/json' };

let history = "", daily = "", eta = "", dns = "";
const srv = http.createServer((q, r) => {
  const u = q.url.split('?')[0];
  if (u === '/history.jsonl') return r.end(history);
  if (u === '/disk-daily.jsonl') return r.end(daily);
  if (u === '/adguard-daily.jsonl') return r.end(dns);
  if (u === '/disk-eta.json') { if (!eta) { r.statusCode = 404; return r.end(); } return r.end(eta); }
  const f = path.join(WEB, u === '/' ? 'index.html' : u);
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { r.statusCode = 404; return r.end(); }
  r.setHeader('content-type', MIME[path.extname(f)] || 'text/plain'); r.end(fs.readFileSync(f));
});

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map(), waiters = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { ok, ko } = pending.get(m.id); pending.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); }
    else if (m.method) for (const w of waiters.filter(w => w.method === m.method)) { waiters.splice(waiters.indexOf(w), 1); w.ok(m.params); }
  };
  const ready = new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('websocket DevTools')); });
  return { ready, send: (method, params = {}) => new Promise((ok, ko) => { pending.set(++id, { ok, ko }); ws.send(JSON.stringify({ id, method, params })); }),
    once: method => new Promise(ok => waiters.push({ method, ok })) };
}
async function waitHttp(url, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) { try { const r = await fetch(url); if (r.status < 500) return r; } catch {} }
  throw new Error(`nessuna risposta da ${url}`);
}

const sample = i => JSON.stringify({ t: now - i * 300, bat: 60 + (i % 20), st: 'In carica', bt: 30 + (i % 8), ct: 40 + (i % 15), cpu: i % 50, ram: 40, disk: 10 });
const dayRow = i => JSON.stringify({ t: now - i * 86400, used: (10 + (40 - i) * 0.5) * 1e9, total: 30e9 });
const dnsRow = i => JSON.stringify({ d: 'x', t: now - i * 86400, queries: 2000, blocked: 400 + i * 10, latency_ms: 12 });
const dnsFull = Array.from({ length: 40 }, (_, i) => dnsRow(i)).join("\n") + "\n";
const dailyFull = Array.from({ length: 40 }, (_, i) => dayRow(i)).join('\n') + '\n';
const full = Array.from({ length: 2016 }, (_, i) => sample(i)).join('\n') + '\n';

(async () => {
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`, dport = srv.address().port + 1;
  const chrome = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${dport}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${path.join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  kids.push(chrome);
  await waitHttp(`http://127.0.0.1:${dport}/json/version`, 60000);
  const page = (await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json()).find(t => t.type === 'page');
  const c = cdp(page.webSocketDebuggerUrl);
  await c.ready; await c.send('Page.enable');
  const ev = async expr => (await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const waitFor = async (expr, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await ev(expr)) return true; return false; };
  let failed = 0;
  const check = (ok, msg) => { if (!ok) { failed++; console.log(`FAIL: dashboard-charts: ${msg}`); } };
  const cases = [
    { name: 'completo', body: full, width: 390, mobile: true, lines: 8, points: 'many' },
    { name: 'completo-desktop', body: full, width: 1280, mobile: false, lines: 8, points: 'many' },
    { name: 'un campione', body: sample(0) + '\n', width: 390, mobile: true, lines: 0, dots: 6, dailyNone: true },
    { name: 'vuoto', body: '', width: 390, mobile: true, lines: 0, dots: 0, empty: 8, dailyNone: true },
    { name: 'righe rotte', body: 'x\n{"a":1}\n' + sample(1) + '\n', width: 390, mobile: true, lines: 0, dots: 6, dailyNone: true },
  ];
  for (const k of cases) {
    history = k.body;
    daily = k.dailyNone ? '' : dailyFull;
    dns = k.dailyNone ? "" : dnsFull;
    eta = k.dailyNone ? '' : JSON.stringify({ state: 'days', days: 21, per_day: 5e8 });
    await c.send('Emulation.setDeviceMetricsOverride', { width: k.width, height: 800, deviceScaleFactor: 1, mobile: k.mobile });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: `${base}/` }); await loaded;
    const ok = await waitFor(`document.querySelectorAll('#history .hchart svg').length === 8`);
    check(ok, `${k.name}: gli 8 grafici non compaiono`);
    if (!ok) continue;
    const n = sel => ev(`document.querySelectorAll('#history ${sel}').length`);
    check(await n('polyline') === k.lines, `${k.name}: polyline ${await n('polyline')} invece di ${k.lines}`);
    if (k.dots !== undefined) check(await n('circle') === k.dots, `${k.name}: punti ${await n('circle')} invece di ${k.dots}`);
    if (k.empty) check(await n('.hempty') === k.empty, `${k.name}: testo «nessun dato» mancante`);
    if (!k.dailyNone) {
      check(await ev(`document.querySelectorAll('#history .hdisk polyline').length === 1`), `${k.name}: grafico del disco senza linea`);
      check(await ev(`document.querySelector('#history .hdisk polyline').getAttribute('points').split(' ').length >= 30`), `${k.name}: meno di 30 giorni di disco`);
      check(await ev(`document.querySelector('#history .hdisk .hnote').textContent.includes('circa 21 giorni')`), `${k.name}: stima mancante`);
    } else check(await ev(`document.querySelector('#history .hdisk .hnote').textContent.includes('almeno 3 giorni')`), `${k.name}: nota senza dati errata`);
    if (!k.dailyNone) check(await ev(`document.querySelectorAll('#history .hdns polyline').length === 1 && document.querySelector('#history .hdns .hhead, #history .hdns').textContent.includes('DNS')`), `${k.name}: grafico DNS mancante`);
    check(await ev(`[...document.querySelectorAll('#history svg')].every(s => (s.getAttribute('aria-label') || '').length > 10 && s.getAttribute('role') === 'img')`), `${k.name}: aria-label mancante`);
    if (k.points === 'many') {
      check(await ev(`document.querySelector('#history polyline').getAttribute('points').split(' ').length > 200`), `${k.name}: troppi pochi punti nelle 24 ore`);
      await ev(`[...document.querySelectorAll('#history .hbtn')].find(b => b.textContent === '7 giorni').click()`);
      check(await ev(`document.querySelector('#history polyline').getAttribute('points').split(' ').length > 1500`), `${k.name}: il pulsante 7 giorni non allunga i grafici`);
      check(await ev(`document.querySelector('#history .hbtn[aria-pressed=true]').textContent === '7 giorni'`), `${k.name}: pulsante non premuto`);
    }
    check(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 0.5`), `${k.name}: la pagina scorre in orizzontale`);
  }
  // issue 362: adaptive window, axis labels, min/max/mean line, cursor, at phone width 360
  history = Array.from({ length: 66 }, (_, i) => sample(i)).join('\n') + '\n'; // ~5.5 h
  daily = dailyFull; dns = dnsFull; eta = "";
  await c.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
  const loaded = c.once('Page.loadEventFired');
  await c.send('Page.navigate', { url: `${base}/` }); await loaded;
  check(await waitFor(`document.querySelectorAll('#history .hchart svg').length === 8`), '362: grafici assenti');
  await sleep(500);
  check(await ev(`(() => { const s = document.querySelector('#history .hchart svg'); const p = s.querySelector('polyline').getBBox(); const v = s.viewBox.baseVal; return p.x + p.width > v.width - 12 && p.x < 40; })()`), '362: la linea non riempie la larghezza con 5 ore di dati');
  check(await ev(`(() => { const s = document.querySelector('#history .hchart svg'); return Math.abs(s.viewBox.baseVal.width - s.getBoundingClientRect().width) < 1.5; })()`), '362: viewBox non in pixel reali');
  check(await ev(`[...document.querySelectorAll('#history .hchart svg')].slice(0, 6).every(s => s.querySelectorAll('.hlab').length >= 4 && /^\\d{2}:\\d{2}$/.test([...s.querySelectorAll('.hlab')].pop().textContent))`), '362: etichette degli assi mancanti');
  check(await ev(`[...document.querySelectorAll('#history .hstat')].slice(0, 6).every(e => /^min [\\d.]+ · max [\\d.]+ · media [\\d.]+/.test(e.textContent))`), '362: riga min · max · media mancante');
  check(await ev(`!document.querySelector('#history svg[preserveAspectRatio]')`), '362: preserveAspectRatio presente');
  for (let k = 0; k < 4; k++) {
    const r = await ev(`(() => { const s = document.querySelector('#history .hchart svg'); s.scrollIntoView({ block: 'center' }); const b = s.getBoundingClientRect(); return [b.left + b.width * (0.2 + 0.2 * ${k}), b.top + 60]; })()`);
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r[0], y: r[1] });
    for (const type of ['mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 });
    check(await ev(`(() => { const g = document.querySelector('#history .hchart svg .hcur'); return g.getAttribute('visibility') === 'visible' && /^\\d{2}:\\d{2} · [\\d.]+%$/.test(g.querySelector('text').textContent); })()`), `362: cursore al tocco ${k} senza orario e valore`);
  }
  check(await ev(`document.querySelectorAll('#history .hchart svg .hcur').length === 1 && document.querySelectorAll('#history svg polyline').length === 8`), '362: elementi duplicati dopo i tocchi');
  check(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 0.5`), '362: scorre in orizzontale a 360 px');
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  const shotPath = process.env.CHARTS_SHOT || path.join(tmp, 'charts-360.png');
  fs.writeFileSync(shotPath, Buffer.from(shot.data, 'base64'));
  console.log(failed ? `FAIL: dashboard-charts: ${failed} controlli` : 'ok: dashboard-charts');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log(`FAIL: dashboard-charts: ${e.message}`); process.exit(2); });
