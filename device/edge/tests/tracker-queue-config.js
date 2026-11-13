// Test of /api/queue-config (issue 225). Offline. From the repo root: device/edge/tests/tracker-queue-config.sh
const { spawn, execFileSync } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-qc-'));
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
  fs.writeFileSync(list, 'home-server | - | - | active | issues | -\nbeta | https://x/b.git | - | active | github | -\n');
  const port = 20000 + crypto.randomInt(20000), base = `http://127.0.0.1:${port}`, none = path.join(tmp, 'none');
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'tracker', 'server.js')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
    TRACKER_ORIGINS: base, TRACKER_REPO: repo, TRACKER_STATE: st, TRACKER_PORT: String(port), TRACKER_AUTHOR: 'owner', TRACKER_SETTINGS: path.join(tmp, 's.env'),
    TRACKER_QUEUE_CONFIG: qfile, HS_QUEUE_PROJECTS_JSON: mirror, HS_PROJECTS_FILE: list, TRACKER_PROJECTS_ISSUES: mirror,
    TRACKER_AUTO_STATUS: none, TRACKER_AUTO_REQUEST: none, TRACKER_AUTO_LOG: none, TRACKER_AUTO_USAGE: none } });
  for (let i = 0; i < 75; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(200); }
  assert.equal((await fetch(`${base}/api/queue-config`)).status, 401, 'needs the owner session');
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: pw }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(login.ok && cookie, 'login');
  const H = { cookie, origin: base, 'content-type': 'application/json' };
  const req = (m, u, b) => fetch(`${base}/api/queue-config${u}`, { method: m, headers: H, body: b && JSON.stringify(b) });
  const base0 = { strategy: 'rotation', urgent_first: false, focus: '', sources: {} };
  let d = await (await req('GET', '')).json();
  assert.deepEqual(d.config, base0, 'default = rotation');
  assert.deepEqual(d.sources, ['home-server', 'beta']);
  assert.deepEqual(d.preview.map(i => i.id), ['011', 'beta#1', '010', 'beta#2']);
  // invalid configs are refused and nothing is written
  for (const c of [{ ...base0, strategy: 'random' }, { ...base0, urgent_first: 'yes' }, { ...base0, strategy: 'focus' }, { ...base0, strategy: 'focus', focus: 'nope' },
    { ...base0, sources: { beta: { weight: 6, paused: false } } }, { ...base0, sources: { beta: { weight: 0, paused: false } } }, { ...base0, sources: { beta: { weight: 1.5, paused: false } } },
    { ...base0, sources: { evil: { weight: 1, paused: false } } }, { ...base0, sources: { beta: { weight: 1, paused: 'x' } } }, null, []])
    for (const [m, u] of [['PUT', ''], ['POST', '/preview']]) assert.equal((await req(m, u, { config: c })).status, 400, JSON.stringify(c));
  assert.ok(!fs.existsSync(qfile));
  // preview computes, does not save
  const prio = { ...base0, strategy: 'priority' };
  d = await (await req('POST', '/preview', { config: prio })).json();
  assert.deepEqual(d.preview.map(i => i.id), ['011', 'beta#2', 'beta#1', '010']);
  assert.ok(!fs.existsSync(qfile));
  // save, then ops-auto's selector (issues.js --order) reads the same file and gives the same order
  d = await (await req('PUT', '', { config: prio })).json();
  assert.equal(JSON.parse(fs.readFileSync(qfile, 'utf8')).strategy, 'priority');
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'tracker', 'issues.js'), '--order', repo], { encoding: 'utf8', input: 'r 010-x.md\nr 011-x.md\nr beta-1\nr beta-2\n',
    env: { ...process.env, HS_QUEUE_CONFIG: qfile, HS_QUEUE_PROJECTS_JSON: mirror, HS_QUEUE_RR: none } }).split('\n').filter(Boolean);
  assert.deepEqual(out, ['011-x.md', 'beta-2', 'beta-1', '010-x.md']);
  assert.deepEqual((await (await req('GET', '')).json()).preview.map(i => i.id), ['011', 'beta#2', 'beta#1', '010']);
  console.log('ok tracker-queue-config');
})().then(() => { cleanup(); process.exit(0); }, e => { console.error(e); cleanup(); process.exit(1); });
