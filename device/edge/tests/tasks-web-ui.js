#!/usr/bin/env node
// Functional test of the tasks/calendar web app (issue 019, issue 178): a throwaway Radicale (Debian
// package, htpasswd plain) with a VTODO and a VEVENT calendar, a tiny node server that serves tasks-web/
// under /app/ and proxies the rest to Radicale like the Caddy site does (X-Tasks-App drops WWW-Authenticate),
// and headless Chromium over the DevTools protocol (Node's WebSocket, no npm dependencies). Walks the
// steps of the issue: wrong password, task (create with a date, tick, show completed, delete) and
// event (create, change the time, delete), checking the CalDAV objects on the server after each step.
// Usage: node device/edge/tests/tasks-web-ui.js     Exit 0 ok, 1 failures, 2 setup error, 77 Chromium or Radicale missing.
'use strict';
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const has = b => { try { execFileSync('sh', ['-c', `command -v ${b}`], { stdio: 'ignore' }); return true; } catch { return false; } };
const CHROME = ['chromium', 'chromium-browser', 'google-chrome'].find(has);
if (!CHROME || !has('radicale') || !has('python3')) { console.log('skip: chromium o radicale non installati'); process.exit(77); }

const WEB = path.join(__dirname, '..', 'debian', 'tasks-web');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-web-ui-'));
const kids = [];
function cleanup() { for (const k of kids) try { k.kill('SIGKILL'); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); }
process.on('exit', cleanup);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A check that throws (e.g. the page has not built an element yet) counts as "not yet".
async function waitFor(fn, ms = 10000) { for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await fn().catch(() => false)) return true; return false; }
async function waitHttp(url, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) { try { const r = await fetch(url); if (r.status < 500) return r; } catch {} }
  throw new Error(`nessuna risposta da ${url}`);
}

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { ok, ko } = pending.get(m.id); pending.delete(m.id); m.error ? ko(new Error(m.error.message)) : ok(m.result); }
  };
  const ready = new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('websocket DevTools')); });
  return { ready, close: () => ws.close(), send: (method, params = {}) => new Promise((ok, ko) => { pending.set(++id, { ok, ko }); ws.send(JSON.stringify({ id, method, params })); }) };
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
function front(rport, port) {
  const srv = http.createServer((req, res) => {
    if (req.url === '/app') { res.writeHead(301, { location: '/app/' }); return res.end(); }
    if (req.url.startsWith('/app/')) {
      const f = req.url.slice(5).split('?')[0] || 'index.html';
      const p = path.join(WEB, path.basename(f));
      if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream',
        'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      return res.end(fs.readFileSync(p));
    }
    const up = http.request({ host: '127.0.0.1', port: rport, method: req.method, path: req.url, headers: req.headers }, r => {
      const h = { ...r.headers };
      if (req.headers['x-tasks-app'] === '1') delete h['www-authenticate'];
      res.writeHead(r.statusCode, h); r.pipe(res);
    });
    req.pipe(up);
  });
  return new Promise(ok => srv.listen(port, '127.0.0.1', () => { kids.push({ kill: () => srv.close() }); ok(); }));
}

async function main() {
  const rport = 20000 + crypto.randomInt(10000), port = rport + 1, dport = rport + 2;
  const base = `http://127.0.0.1:${port}`, pw = crypto.randomBytes(8).toString('hex');
  fs.writeFileSync(path.join(tmp, 'users'), `testuser:${pw}\n`);
  fs.writeFileSync(path.join(tmp, 'config'), `[server]\nhosts = 127.0.0.1:${rport}\n[auth]\ntype = htpasswd\nhtpasswd_filename = ${tmp}/users\nhtpasswd_encryption = plain\n` +
    `[storage]\nfilesystem_folder = ${tmp}/col\n[logging]\nlevel = warning\n`);
  kids.push(spawn('python3', ['-m', 'radicale', '--config', path.join(tmp, 'config')], { stdio: ['ignore', 'ignore', 'inherit'] }));
  await waitHttp(`http://127.0.0.1:${rport}/`, 20000);
  await front(rport, port);

  const basic = 'Basic ' + Buffer.from(`testuser:${pw}`).toString('base64');
  const dav = (method, p, body, headers = {}) => fetch(base + p, { method, headers: { authorization: basic, 'content-type': 'application/xml', ...headers }, body });
  for (const [name, comp] of [['tasks', 'VTODO'], ['cal', 'VEVENT']]) {
    const r = await dav('MKCALENDAR', `/testuser/${name}/`, `<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop>` +
      `<C:supported-calendar-component-set><C:comp name="${comp}"/></C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>`);
    if (r.status !== 201) throw new Error(`MKCALENDAR ${name}: ${r.status}`);
  }
  // Objects now on the server of one calendar: [{ href, text }].
  const objects = async name => {
    const t = await (await dav('PROPFIND', `/testuser/${name}/`, '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><getetag/></prop></propfind>', { depth: '1' })).text();
    const hrefs = [...t.matchAll(/<(?:\w+:)?href>([^<]+\.ics)</g)].map(m => m[1]);
    return Promise.all(hrefs.map(async href => ({ href, text: await (await dav('GET', href)).text() })));
  };

  const chrome = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${dport}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${path.join(tmp, 'chrome')}`, 'about:blank'], { stdio: 'ignore', env: { ...process.env, TZ: 'Europe/Rome' } });
  kids.push(chrome);
  await waitHttp(`http://127.0.0.1:${dport}/json/version`, 60000);
  const page = (await (await fetch(`http://127.0.0.1:${dport}/json/list`)).json()).find(t => t.type === 'page');
  const c = cdp(page.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const ev = async expr => { const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`pagina: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`); return r.result.value; };
  const fill = (sel, v) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; if (e.type === 'checkbox') e.checked = ${JSON.stringify(v)}; else e.value = ${JSON.stringify(v)};
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const click = sel => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.click(); return !!e; })()`);
  const text = sel => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? null`);
  const shots = process.argv[2]; if (shots) fs.mkdirSync(shots, { recursive: true });
  const shot = async n => { if (shots) fs.writeFileSync(path.join(shots, `${n}.png`), Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); };

  let failed = 0;
  const check = (name, cond, extra = '') => { if (cond) console.log(`ok ${name}`); else { failed++; console.log(`FAIL ${name} ${extra}`); } };
  const day = n => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dayIcs = n => day(n).replace(/-/g, '');

  await c.send('Page.navigate', { url: `${base}/app/` });
  await waitFor(() => ev(`!document.querySelector('#login').hidden`));
  await ev(`window.confirm = () => true`);

  // Wrong password: the app's own message, no browser prompt.
  await fill('#login [name=user]', 'testuser'); await fill('#login [name=pass]', 'sbagliata');
  await ev(`document.querySelector('#login').requestSubmit()`);
  check('password sbagliata: messaggio dell\'app', await waitFor(async () => /non validi/.test(await text('#login-err') || '')), await text('#login-err'));
  await fill('#login [name=pass]', pw);
  await ev(`document.querySelector('#login').requestSubmit()`);
  check('accesso', await waitFor(() => ev(`!document.querySelector('#main').hidden && !document.querySelector('#todo').hidden`)), await text('#login-err'));
  await shot('01-attivita-vuote');

  // Tasks.
  await fill('#todo-add [name=summary]', 'prova app'); await fill('#todo-add [name=due]', day(1));
  await ev(`document.querySelector('#todo-add').requestSubmit()`);
  check('attività: compare nella lista', await waitFor(async () => /prova app/.test(await text('#todo-list') || '')), await text('#todo-list'));
  let o = await objects('tasks');
  check('attività: sul server con scadenza', o.length === 1 && /SUMMARY:prova app/.test(o[0].text) && o[0].text.includes(`DUE;VALUE=DATE:${dayIcs(1)}`), JSON.stringify(o));
  check('attività: data mostrata', /\d/.test(await text('#todo-list li .d') || ''));
  await shot('02-attivita');
  await click('#todo-list li input[type=checkbox]');
  check('attività: spuntata (sparisce dalle aperte)', await waitFor(async () => /Nessuna attività aperta/.test(await text('#todo-list') || '')));
  o = await objects('tasks');
  check('attività: COMPLETED sul server', /STATUS:COMPLETED/.test(o[0]?.text || '') && /COMPLETED:\d{8}T\d{6}Z/.test(o[0].text) && /PERCENT-COMPLETE:100/.test(o[0].text));
  check('attività: completate nascoste di default', await ev(`document.querySelector('#done-list').hidden`));
  await fill('#show-done', true);
  check('attività: «Mostra completate»', await waitFor(async () => /prova app/.test(await text('#done-list') || '')));
  await click('#done-list li');
  check('attività: si apre la modifica', await waitFor(() => ev(`document.querySelector('#todo-dlg').open`)));
  check('attività: modifica precompilata', await ev(`document.querySelector('#todo-dlg [name=summary]').value`) === 'prova app');
  await fill('#todo-dlg [name=description]', 'una nota');
  await ev(`document.querySelector('#done-list li').dataset.old = '1'`);
  await click('#todo-dlg button[value=save]');
  check('attività: modifica salvata', await waitFor(async () => /DESCRIPTION:una nota/.test((await objects('tasks'))[0]?.text || '')));
  await waitFor(() => ev(`!document.querySelector('#todo-dlg').open`));
  // Wait for the list to be redrawn after the save (a fresh <li>), else the dialog opens with a stale ETag and the delete is refused.
  await waitFor(() => ev(`!!document.querySelector('#done-list li:not([data-old])')`));
  await click('#done-list li');
  await waitFor(() => ev(`document.querySelector('#todo-dlg').open`));
  await click('#todo-dlg [data-act=delete]');
  check('attività: eliminata', await waitFor(async () => (await objects('tasks')).length === 0));
  check('attività: sparita dalla lista', await waitFor(async () => !(await text('#done-list') || '').includes('prova app')));

  // Events.
  await click('.tab[data-tab=agenda]');
  check('agenda: vuota', await waitFor(async () => /Nessun evento/.test(await text('#agenda-list') || '')));
  await click('#event-new');
  check('evento: si apre il dialogo', await waitFor(() => ev(`document.querySelector('#event-dlg').open`)));
  await fill('#event-dlg [name=summary]', 'Cena di prova'); await fill('#event-dlg [name=date]', day(2));
  await fill('#event-dlg [name=start]', '20:30'); await fill('#event-dlg [name=end]', '22:00'); await fill('#event-dlg [name=location]', 'Casa');
  await shot('03-evento-dialogo');
  await click('#event-dlg button[value=save]');
  check('evento: compare in agenda', await waitFor(async () => /Cena di prova/.test(await text('#agenda-list') || '')), await text('#agenda-list'));
  o = await objects('cal');
  check('evento: sul server con orari', o.length === 1 && o[0].text.includes(`DTSTART;TZID=Europe/Rome:${dayIcs(2)}T203000`) && o[0].text.includes(`DTEND;TZID=Europe/Rome:${dayIcs(2)}T220000`) && /LOCATION:Casa/.test(o[0].text), JSON.stringify(o));
  check('evento: orario mostrato', /20:30.22:00/.test(await text('#agenda-list') || ''), await text('#agenda-list'));
  await shot('04-agenda');
  await click('#agenda-list .ev');
  check('evento: si apre la modifica', await waitFor(() => ev(`document.querySelector('#event-dlg').open && document.querySelector('#event-dlg [name=summary]').value === 'Cena di prova'`)));
  await fill('#event-dlg [name=start]', '19:00'); await fill('#event-dlg [name=end]', '21:00');
  await click('#event-dlg button[value=save]');
  check('evento: orario cambiato sul server', await waitFor(async () => (await objects('cal'))[0]?.text.includes(`DTSTART;TZID=Europe/Rome:${dayIcs(2)}T190000`)));
  check('evento: nuovo orario in agenda', await waitFor(async () => /19:00.21:00/.test(await text('#agenda-list') || '')));
  await click('#agenda-list .ev');
  await waitFor(() => ev(`document.querySelector('#event-dlg').open`));
  await click('#event-dlg [data-act=delete]');
  check('evento: eliminato', await waitFor(async () => (await objects('cal')).length === 0));
  check('evento: sparito dall\'agenda', await waitFor(async () => /Nessun evento/.test(await text('#agenda-list') || '')));
  c.close();
  console.log(failed ? `${failed} controlli falliti` : 'tasks-web-ui: ok');
  return failed ? 1 : 0;
}
main().then(rc => process.exit(rc), e => { console.error(e.message); process.exit(2); });
