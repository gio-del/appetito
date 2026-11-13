// Test of the Owner-confirmed mark written by the tracker (issue 478). Offline.
// From the repo root: device/edge/tests/tracker-owner-confirmed.sh
const { spawn, execFileSync } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-oc-'));
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
  const file = path.join(repo, 'issues', 'open', '010-x.md');
  fs.writeFileSync(file, '# T 10\n\nOpened: 2026-01-01\nBlocked on: -\nStatus: backlog\n');
  const none = path.join(tmp, 'none');
  const port = 20000 + crypto.randomInt(20000), base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'tracker', 'server.js')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
    TRACKER_ORIGINS: base, TRACKER_REPO: repo, TRACKER_STATE: st, TRACKER_PORT: String(port), TRACKER_AUTHOR: 'owner', TRACKER_SETTINGS: path.join(tmp, 's.env'),
    TRACKER_AUTO_STATUS: none, TRACKER_AUTO_REQUEST: none, TRACKER_AUTO_LOG: none, TRACKER_AUTO_USAGE: none } });
  for (let i = 0; i < 75; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(200); }
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: pw }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(login.ok && cookie, 'login');
  const H = { cookie, origin: base, 'content-type': 'application/json' };
  const get = async () => (await fetch(`${base}/api/issues/010`, { headers: H })).json();
  const move = async column => { const d = await get(); const r = await fetch(`${base}/api/issues/010`, { method: 'PATCH', headers: H, body: JSON.stringify({ version: d.version, column }) }); assert.ok(r.ok, `move ${column}: ${r.status}`); };
  const today = new Date(); const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  assert.equal((await get()).ownerConfirmed, '', 'no mark at start');
  await move('todo');
  assert.equal((await get()).ownerConfirmed, day, 'To do gives the mark');
  assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`^Owner-confirmed: ${day}$`, 'm'));
  await move('backlog');
  assert.equal((await get()).ownerConfirmed, '', 'back to backlog removes it');
  assert.ok(!/Owner-confirmed/.test(fs.readFileSync(file, 'utf8')));
  await move('in-progress');
  assert.equal((await get()).ownerConfirmed, day, 'In corso gives the mark');
  console.log('ok tracker-owner-confirmed');
})().then(() => { cleanup(); process.exit(0); }, e => { console.error(e); cleanup(); process.exit(1); });
