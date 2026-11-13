// Offline test of the second brain questions (issue 294), on a throwaway repo.
const { spawn, execFileSync } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-question-'));
let srv;
const cleanup = () => { try { srv && srv.kill('SIGKILL'); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const pw = 'pw' + crypto.randomBytes(8).toString('hex');
  const st = path.join(tmp, 'state'), s = crypto.randomBytes(16), N = 1024;
  fs.mkdirSync(st);
  fs.writeFileSync(path.join(st, 'password'), ['scrypt', N, 8, 1, s.toString('base64'), crypto.scryptSync(pw, s, 32, { N, r: 8, p: 1 }).toString('base64')].join('$') + '\n');
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(path.join(st, 'propose-token'), crypto.createHash('sha256').update(token).digest('hex') + '\n');
  const repo = path.join(tmp, 'repo');
  for (const d of ['open', 'done', 'proposed']) fs.mkdirSync(path.join(repo, 'issues', d), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q']);
  const projects = path.join(tmp, 'projects');
  fs.writeFileSync(projects, '# c\nhome-server | - | - | active | issues | -\nsumisura | u | sumisura | active | github | -\n');
  const port = 20000 + crypto.randomInt(20000), base = `http://127.0.0.1:${port}`;
  const none = path.join(tmp, 'none');
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'tracker', 'server.js')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
    TRACKER_ORIGINS: base, TRACKER_REPO: repo, TRACKER_STATE: st, TRACKER_PORT: String(port), TRACKER_AUTHOR: 'owner', TRACKER_SETTINGS: path.join(tmp, 's.env'),
    TRACKER_BRAIN_ANSWERS: path.join(tmp, 'answers'), TRACKER_AUTO_STATUS: none, TRACKER_AUTO_REQUEST: none, TRACKER_AUTO_LOG: none, TRACKER_AUTO_USAGE: none } });
  for (let i = 0; i < 75; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(200); }
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: pw }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(login.ok && cookie, 'login');
  const call = async (method, url, body, headers) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, ...headers }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const owner = (m, u, b) => call(m, u, b, { cookie });
  const propose = b => call('POST', '/api/propose', { desc: '## Problema\nx', labels: ['feature', 'afk'], ...b }, { authorization: `Bearer ${token}` });

  const q = await propose({ title: 'Progetto o parte del server?', desc: 'Opzioni: A, B', labels: ['question'], origin: 'Inbox/bug libreria.md' });
  assert.strictEqual(q.status, 201, JSON.stringify(q.body));
  const w = await propose({ title: 'Proposta normale', origin: 'Inbox/y.md' });
  assert.strictEqual(w.status, 201);
  let d = (await owner('GET', `/api/issues/${q.body.id}`)).body;
  assert.ok(d.labels.includes('question') && d.column === 'proposed');
  assert.strictEqual((await owner('PATCH', `/api/issues/${q.body.id}`, { version: d.version, approve: { status: 'todo' } })).status, 400, 'a question is not approved');
  const dn = (await owner('GET', `/api/issues/${w.body.id}`)).body;
  assert.strictEqual((await owner('PATCH', `/api/issues/${w.body.id}`, { version: dn.version, answer: 'x' })).status, 400, 'answer only for questions');
  assert.strictEqual((await owner('PATCH', `/api/issues/${q.body.id}`, { version: d.version, answer: '  ' })).status, 400, 'empty answer');
  assert.ok(!fs.existsSync(path.join(tmp, 'answers')) || fs.readdirSync(path.join(tmp, 'answers')).length === 0);
  const r = await owner('PATCH', `/api/issues/${q.body.id}`, { version: d.version, answer: 'Una parte del server' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const f = JSON.parse(fs.readFileSync(path.join(tmp, 'answers', `${q.body.id}.json`), 'utf8'));
  assert.deepStrictEqual([f.id, f.origin, f.answer], [q.body.id, 'Inbox/bug libreria.md', 'Una parte del server']);
  assert.ok(!JSON.stringify(f).includes('Opzioni'), 'description stays out of the answer');
  assert.ok(fs.readdirSync(path.join(repo, 'issues', 'done')).some(x => x.startsWith(q.body.id)), 'question closed');
  assert.ok(!fs.readdirSync(path.join(repo, 'issues', 'proposed')).some(x => x.startsWith(q.body.id)), 'left proposed');
  // daily limit of questions is separate from the proposals
  let last;
  for (let i = 0; i < 10; i++) last = await propose({ title: 'Domanda ' + i, labels: ['question'], origin: 'Inbox/z.md' });
  assert.strictEqual(last.status, 429, 'question limit');
  assert.strictEqual((await propose({ title: 'Ancora una normale', origin: 'Inbox/y.md' })).status, 201);
  console.log('ok tracker-question');
  cleanup();
})().catch(e => { console.error('FAIL:', e.message); cleanup(); process.exit(1); });
