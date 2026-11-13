// Test of /api/queue-config (issue 225). Offline. From the repo root: device/edge/tests/tracker-queue-config.sh
const { spawn, execFileSync } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-apps-'));
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
  const mk = (id, prio) => fs.writeFileSync(path.join(repo, 'issues', 'open', `${id}-x.md`), `# T ${id}\n\nOpened: 2026-01-01\nBlocked on: -\nStatus: todo\nPriority: ${prio}\n`);
  mk('010', 'low'); mk('011', 'urgent');
  const mirror = path.join(tmp, 'pj.json'), list = path.join(tmp, 'projects'), qfile = path.join(tmp, 'queue.json');
  const it = (n, labels = []) => ({ number: n, title: `P${n}`, state: 'open', trust: 'author', labels });
  fs.writeFileSync(mirror, JSON.stringify({ projects: { beta: { stale: false, issues: [it(1), it(2, ['priority:urgent'])] } } }));
  fs.mkdirSync(path.join(tmp, 'ast')); fs.writeFileSync(path.join(tmp, 'ast', 'beta-app.off'), '2026-11-01\n');
  fs.writeFileSync(list, 'home-server | - | - | active | issues | -\nbeta | https://x/b.git | beta-app | active | github | -\n');
  const port = 20000 + crypto.randomInt(20000), base = `http://127.0.0.1:${port}`, none = path.join(tmp, 'none');
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'tracker', 'server.js')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
    TRACKER_ORIGINS: base, TRACKER_REPO: repo, TRACKER_STATE: st, TRACKER_PORT: String(port), TRACKER_AUTHOR: 'owner', TRACKER_SETTINGS: path.join(tmp, 's.env'),
    TRACKER_QUEUE_CONFIG: qfile, TRACKER_APPS_STATE: path.join(tmp, 'ast'), TRACKER_APPS_REQ: path.join(tmp, 'areq'), HS_QUEUE_PROJECTS_JSON: mirror, HS_PROJECTS_FILE: list, TRACKER_PROJECTS_ISSUES: mirror,
    TRACKER_AUTO_STATUS: none, TRACKER_AUTO_REQUEST: none, TRACKER_AUTO_LOG: none, TRACKER_AUTO_USAGE: none } });
  for (let i = 0; i < 75; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(200); }
  assert.equal((await fetch(`${base}/api/queue-config`)).status, 401, 'needs the owner session');
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: pw }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(login.ok && cookie, 'login');
  const H = { cookie, origin: base, 'content-type': 'application/json' };
  const post = b => fetch(`${base}/api/apps`, { method: 'POST', headers: H, body: JSON.stringify(b) });
  assert.equal((await fetch(`${base}/api/apps`)).status, 401, 'needs the owner session');
  const g = await (await fetch(`${base}/api/apps`, { headers: H })).json();
  assert.deepEqual(g.apps, [
    { app: 'beta-app', off: '2026-11-01', always: false, new: false, feature: false },
    { app: 'proposte', off: '', always: false, new: false, feature: true },
    { app: 'domande', off: '', always: false, new: false, feature: true },
    { app: 'smistamento', off: '', always: false, new: false, feature: true },
    { app: 'cv', off: '', always: false, new: false, feature: true },
  ]);
  assert.equal((await post({ app: 'domande', action: 'trial' })).status, 400, 'no trial for a feature');
  assert.equal((await post({ app: 'domande', action: 'on' })).status, 202, 'feature on');
  assert.equal((await post({ app: 'vaultwarden', action: 'on' })).status, 400, 'base service refused');
  assert.equal((await post({ app: 'beta-app', action: 'rm' })).status, 400, 'unknown action refused');
  assert.equal((await post({ app: 'beta-app', action: 'on' })).status, 202);
  assert.equal(fs.readFileSync(path.join(tmp, 'areq', 'beta-app'), 'utf8'), 'on\n');
  console.log('ok tracker-apps');
})().then(() => { cleanup(); process.exit(0); }, e => { console.error(e); cleanup(); process.exit(1); });
