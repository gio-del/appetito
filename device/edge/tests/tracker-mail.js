// Test of the tracker's Mail page API (issue 015): GET /api/mail, PUT /api/mail/url, POST /api/mail/test on throwaway dirs.
// Offline. From the repo root: device/edge/tests/tracker-mail.sh
const { spawn, execFileSync } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-mail-'));
let srv;
const cleanup = () => { try { srv && srv.kill('SIGKILL'); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const pw = 'pw' + crypto.randomBytes(8).toString('hex');
  const st = path.join(tmp, 'state'), s = crypto.randomBytes(16), N = 1024;
  fs.mkdirSync(st);
  fs.writeFileSync(path.join(st, 'password'), ['scrypt', N, 8, 1, s.toString('base64'), crypto.scryptSync(pw, s, 32, { N, r: 8, p: 1 }).toString('base64')].join('$') + '\n');
  const repo = path.join(tmp, 'repo');
  for (const d of ['open', 'done', 'proposed']) fs.mkdirSync(path.join(repo, 'issues', d), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q']);
  const setup = path.join(tmp, 'mail-setup'), status = path.join(tmp, 'mail-status');
  const port = 20000 + crypto.randomInt(20000), base = `http://127.0.0.1:${port}`, none = path.join(tmp, 'none');
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'tracker', 'server.js')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
    TRACKER_ORIGINS: base, TRACKER_REPO: repo, TRACKER_STATE: st, TRACKER_PORT: String(port), TRACKER_AUTHOR: 'owner', TRACKER_SETTINGS: path.join(tmp, 's.env'),
    TRACKER_AUTO_STATUS: none, TRACKER_AUTO_REQUEST: none, TRACKER_AUTO_LOG: none, TRACKER_AUTO_USAGE: none, TRACKER_PROJECTS_ISSUES: none,
    TRACKER_MAIL_SETUP: setup, TRACKER_MAIL_STATUS: status } });
  for (let i = 0; i < 75; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(200); }
  assert.equal((await fetch(`${base}/api/mail`)).status, 401, 'needs the owner session');
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: pw }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(login.ok && cookie, 'login');
  const call = async (method, url, body, origin = base) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin, cookie }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const URL_OK = 'https://script.google.com/macros/s/AKfycbx_abcdefghijklmnopqrstuvwxyz-0123/exec';

  // Off: no setup dir.
  assert.deepEqual((await call('GET', '/api/mail')).body, { enabled: false });
  assert.equal((await call('PUT', '/api/mail/url', { url: URL_OK })).status, 409, 'not enabled');
  fs.mkdirSync(setup); fs.mkdirSync(status);
  fs.writeFileSync(path.join(status, 'edge-mail.gs'), "var SECRET = 'x';\n");
  let g = (await call('GET', '/api/mail')).body;
  assert.equal(g.enabled, true); assert.equal(g.url, ''); assert.equal(g.script, "var SECRET = 'x';\n"); assert.equal(g.testPending, false); assert.equal(g.update, false, "no update before a good answer");
  assert.equal((await call('POST', '/api/mail/test')).status, 409, 'no test before the URL');

  for (const bad of ['https://evil.example/macros/s/AKfycbx_abcdefghijklmnopqrstuvwxyz/exec', 'http://script.google.com/macros/s/AKfycbx_abcdefghijklmnopqrstuvwxyz/exec',
    'https://script.google.com/macros/s/AKfycbx_abcdefghijklmnopqrstuvwxyz/exec?x=1', 'https://script.google.com/macros/s/short/exec', 42])
    assert.equal((await call('PUT', '/api/mail/url', { url: bad })).status, 400, `refused ${bad}`);
  assert.equal((await call('PUT', '/api/mail/url', { url: URL_OK }, 'https://evil.example')).status, 403, 'cross-site write');
  let r = await call('PUT', '/api/mail/url', { url: `  ${URL_OK} ` });
  assert.equal(r.status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(setup, 'url.json'), 'utf8'));
  assert.equal(saved.url, URL_OK); assert.ok(Math.abs(saved.at - Date.now() / 1000) < 10);

  r = await call('POST', '/api/mail/test');
  assert.equal(r.status, 202);
  assert.equal((await call('GET', '/api/mail')).body.testPending, true);
  assert.equal((await call('POST', '/api/mail/test')).status, 429, 'one test a minute');
  fs.writeFileSync(path.join(status, 'status.json'), JSON.stringify({ at: r.body.at + 5, ok: true, alias: 'a+edge@gmail.com', lastOk: r.body.at + 5, test: { at: r.body.at + 5, ok: true } }));
  g = (await call('GET', '/api/mail')).body;
  assert.equal(g.testPending, false); assert.equal(g.status.alias, 'a+edge@gmail.com');
  // Linked and answering, copy still there = a newer script to publish (issue 415); no copy = up to date.
  assert.equal(g.update, true, 'update when the copy is back after a good answer');
  fs.renameSync(path.join(status, 'edge-mail.gs'), path.join(status, 'gs.bak'));
  assert.equal((await call('GET', '/api/mail')).body.update, false, 'no update without the copy');
  fs.renameSync(path.join(status, 'gs.bak'), path.join(status, 'edge-mail.gs'));

  // Scollega.
  assert.equal((await call('PUT', '/api/mail/url', { url: '' })).status, 200);
  assert.ok(!fs.existsSync(path.join(setup, 'url.json')));
  assert.equal((await call('GET', '/api/mail')).body.url, ''); assert.equal((await call('GET', '/api/mail')).body.update, false, 'no update once unlinked');
  assert.ok(!/Claude/.test(fs.readFileSync(path.join(__dirname, '..', 'tracker', 'public', 'mail.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'tracker', 'public', 'mail.html'), 'utf8')), 'AI-neutral texts');
  console.log('ok tracker-mail');
})().then(() => { cleanup(); process.exit(0); }, e => { console.log('FAIL: ' + (e.stack || e)); cleanup(); process.exit(1); });
