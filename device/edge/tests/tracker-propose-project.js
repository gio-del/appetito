// Offline test of proposals tagged with a Project (issue 161), on a throwaway repo.
const { spawn, execFileSync } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-propose-project-'));
let srv;
const cleanup = () => { try { srv && srv.kill('SIGKILL'); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const pw = 'pw' + crypto.randomBytes(8).toString('hex');
  const st = path.join(tmp, 'state'), s = crypto.randomBytes(16), N = 1024;
  fs.mkdirSync(st);
  fs.writeFileSync(path.join(st, 'password'), ['scrypt', N, 8, 1, s.toString('base64'), crypto.scryptSync(pw, s, 32, { N, r: 8, p: 1 }).toString('base64')].join('$') + '\n');
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(path.join(st, 'suggest-token'), crypto.createHash('sha256').update(token).digest('hex') + '\n');
  const repo = path.join(tmp, 'repo');
  for (const d of ['open', 'done', 'proposed']) fs.mkdirSync(path.join(repo, 'issues', d), { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q']);
  const projects = path.join(tmp, 'projects');
  fs.writeFileSync(projects, '# c\nhome-server | - | - | active | issues | -\nsumisura | u | sumisura | active | github | -\n');
  const port = 20000 + crypto.randomInt(20000), base = `http://127.0.0.1:${port}`;
  const none = path.join(tmp, 'none');
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'tracker', 'server.js')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
    TRACKER_ORIGINS: base, TRACKER_REPO: repo, TRACKER_STATE: st, TRACKER_PORT: String(port), TRACKER_AUTHOR: 'owner', TRACKER_SETTINGS: path.join(tmp, 's.env'),
    HS_PROJECTS_FILE: projects, TRACKER_AUTO_STATUS: none, TRACKER_AUTO_REQUEST: none, TRACKER_AUTO_LOG: none, TRACKER_AUTO_USAGE: none } });
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

  const a = await propose({ title: 'Proposta per Sumisura', project: 'sumisura' });
  assert.strictEqual(a.status, 201, JSON.stringify(a.body));
  assert.strictEqual((await propose({ title: 'Progetto sconosciuto', project: 'nope' })).status, 400, 'unknown project');
  const l = await propose({ title: 'Proposta locale senza progetto' });
  assert.strictEqual(l.status, 201);

  const d = (await owner('GET', `/api/issues/${a.body.id}`)).body;
  assert.strictEqual(d.project, 'sumisura');
  const ap = await owner('PATCH', `/api/issues/${a.body.id}`, { version: d.version, approve: { status: 'todo' } });
  assert.strictEqual(ap.status, 200, JSON.stringify(ap.body));
  assert.ok(!fs.readdirSync(path.join(repo, "issues", "proposed")).some(f => f.startsWith(a.body.id)), "left proposed");
  const af = fs.readdirSync(path.join(repo, "issues", "open")).find(f => f.startsWith(a.body.id));
  assert.ok(af, "open");
  const at = fs.readFileSync(path.join(repo, "issues", "open", af), "utf8");
  assert.ok(/^Publish: pending$/m.test(at) && /^Blocked on: publish$/m.test(at) && /^Project: sumisura$/m.test(at), at);
  const q = await owner("GET", "/api/issues/" + a.body.id);
  assert.strictEqual(q.body.column, "blocked", "not workable by ops-auto");

  // the gio cron publishes it (stubbed projects-publish)
  const stub = path.join(tmp, "pp"), argl = path.join(tmp, "pp.args");
  fs.writeFileSync(stub, `#!/bin/sh\necho "$*" >> ${argl}\necho "17 https://github.com/me/s/issues/17"\n`, { mode: 0o755 });
  const run = () => require("child_process").spawnSync(process.execPath, [path.join(__dirname, "..", "debian", "projects-publish-pending"), repo], { env: { ...process.env, HS_PUBLISH_CMD: stub, HS_ISSUES_LIB: path.join(__dirname, "..", "tracker", "issues.js") }, encoding: "utf8" });
  const r = run();
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(repo, "issues", "open", af)), "closed");
  const dt = fs.readFileSync(path.join(repo, "issues", "done", af), "utf8");
  assert.ok(/^GitHub: sumisura#17 https:\/\/github.com/m.test(dt) && /^Closed: \d{4}/m.test(dt) && /^Blocked on: -$/m.test(dt) && dt.includes("(sistema)"), dt);
  assert.ok(dt.includes("Inoltrata a sumisura#17") && dt.includes("il lavoro non è ancora fatto") && /^Publish: done$/m.test(dt), "testo del commento");
  assert.ok(fs.readFileSync(argl, "utf8").startsWith("issue sumisura Proposta per Sumisura "), "args");
  assert.strictEqual(run().status, 0, "idempotent");
  assert.strictEqual(fs.readFileSync(argl, "utf8").trim().split("\n").length, 1, "published once");

  const b2 = await propose({ title: "Altra per Sumisura", project: "sumisura" });
  const d2 = (await owner("GET", `/api/issues/${b2.body.id}`)).body;
  const rj = await owner("PATCH", `/api/issues/${b2.body.id}`, { version: d2.version, reject: { reason: "" } });
  assert.strictEqual(rj.status, 200, JSON.stringify(rj.body));
  const dl = (await owner('GET', `/api/issues/${l.body.id}`)).body;
  assert.strictEqual(dl.project, '');
  const ok = await owner('PATCH', `/api/issues/${l.body.id}`, { version: dl.version, approve: { status: 'todo' } });
  assert.strictEqual(ok.status, 200, 'local proposal still approvable');
  console.log('ok: tracker propose project');
})().then(cleanup, e => { cleanup(); console.error(e); process.exit(1); });
