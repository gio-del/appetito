// Test of /api/projects-issues (issues 091, 184). Offline. From the repo root: device/edge/tests/tracker-projects-issues.sh
const { spawn, execFileSync } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-pj-'));
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
  const file = path.join(tmp, 'pj.json');
  fs.writeFileSync(file, JSON.stringify({ updated: '24/10 20:00', projects: {
    sumisura: { repo: 'o/sumisura', error: '', stale: false, issues: [
      { number: 221, title: 'Mia', state: 'open', url: 'https://github.com/o/sumisura/issues/221', author: 'o', labels: ['bug'], trust: 'author' },
      { number: 7, title: 'Altrui', state: 'closed', url: 'javascript:alert(1)', author: 'x', labels: [], trust: null },
      { number: 'x', title: 'senza numero' }] },
    '../evil': { issues: [] } } }));
  const port = 20000 + crypto.randomInt(20000), base = `http://127.0.0.1:${port}`;
  const none = path.join(tmp, 'none');
  const wdir = path.join(tmp, 'writes'); fs.mkdirSync(wdir);
  const rdir = path.join(tmp, "rreq"); fs.mkdirSync(rdir);
  const rfile = path.join(tmp, "rel.json");
  fs.writeFileSync(rfile, JSON.stringify({ updated: 1, projects: { sumisura: { status: "announced", version: "0.5.0", pr: 9, url: "https://github.com/o/s/pull/9", changelog: "### Features\n* x", release_at: 9e9, rules: [] }, altro: { status: "waiting", rules: [] }, "../evil": { status: "announced" } } }));
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'tracker', 'server.js')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
    TRACKER_ORIGINS: base, TRACKER_REPO: repo, TRACKER_STATE: st, TRACKER_PORT: String(port), TRACKER_AUTHOR: 'owner', TRACKER_SETTINGS: path.join(tmp, 's.env'),
    TRACKER_PROJECTS_ISSUES: file, TRACKER_PROJECTS_WRITES: wdir, TRACKER_RELEASE_STATE: rfile, TRACKER_RELEASE_REQ: rdir, TRACKER_AUTO_STATUS: none, TRACKER_AUTO_REQUEST: none, TRACKER_AUTO_LOG: none, TRACKER_AUTO_USAGE: none } });
  for (let i = 0; i < 75; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(200); }
  assert.equal((await fetch(`${base}/api/projects-issues`)).status, 401, 'needs the owner session');
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: pw }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(login.ok && cookie, 'login');
  const d = await (await fetch(`${base}/api/projects-issues`, { headers: { cookie } })).json();
  assert.deepEqual(Object.keys(d.projects), ['sumisura']);
  const is = d.projects.sumisura.issues;
  assert.deepEqual(is.map(i => i.id), ['sumisura#221', 'sumisura#7']);
  assert.deepEqual(is.map(i => i.trusted), [true, false]);
  assert.equal(is[1].url, '');
  assert.equal(is[1].state, 'closed');
  // Writing (issue 184): validated against the mirror, queued for projects-issue-apply, answer read back.
  const post = b => fetch(`${base}/api/projects-issues/write`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await fetch(`${base}/api/projects-issues/write`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{}' })).status, 401);
  for (const b of [{ project: 'nope', number: 221, action: 'close' }, { project: 'sumisura', number: 999, action: 'close' }, { project: 'sumisura', number: 221, action: 'delete' },
    { project: 'sumisura', number: 221, action: 'comment', text: '  ' }, { project: 'sumisura', number: 221, action: 'label-add', label: 'a"b' }]) assert.equal((await post(b)).status, 400, JSON.stringify(b));
  assert.deepEqual(fs.readdirSync(wdir), []);
  // Rispondi (issue 307): read/answer only for trusted issues, answers validated
  for (const b of [{ project: 'sumisura', number: 7, action: 'read' }, { project: 'sumisura', number: 7, action: 'answer', answers: [{ text: '', kind: 'answer', note: 'x' }] },
    { project: 'sumisura', number: 221, action: 'answer' }, { project: 'sumisura', number: 221, action: 'answer', answers: [] },
    { project: 'sumisura', number: 221, action: 'answer', answers: [{ text: 't', kind: 'answer', note: ' ' }] },
    { project: 'sumisura', number: 221, action: 'answer', answers: [{ text: 't', kind: 'boh', note: 'x' }] },
    { project: 'sumisura', number: 221, action: 'answer', answers: [{ text: 't', kind: 'answer', note: 'x'.repeat(2001) }] }]) assert.equal((await post(b)).status, 400, JSON.stringify(b).slice(0, 80));
  assert.deepEqual(fs.readdirSync(wdir), []);
  const rd = await post({ project: 'sumisura', number: 221, action: 'read' });
  assert.equal(rd.status, 202);
  const rid = (await rd.json()).id;
  fs.writeFileSync(path.join(wdir, `${rid}.res.json`), JSON.stringify({ id: rid, ok: true, msg: 'letto', steps: ['(HITL) scegli', 5], last: { by: 'o', text: 'ciao' }, needs_owner: true, extra: 'x' }));
  assert.deepEqual(await (await fetch(`${base}/api/projects-issues/write/${rid}`, { headers: { cookie } })).json(), { done: true, ok: true, msg: 'letto', steps: ['(HITL) scegli'], last: { by: 'o', text: 'ciao' }, needs_owner: true });
  const an = await post({ project: 'sumisura', number: 221, action: 'answer', answers: [{ text: '(HITL) scegli', kind: 'answer', note: ' A ' }, { text: '(HITL) b', kind: 'done', note: '' }] });
  assert.equal(an.status, 202);
  const aq = JSON.parse(fs.readFileSync(path.join(wdir, `${(await an.json()).id}.req.json`), 'utf8'));
  assert.deepEqual(aq.answers, [{ text: '(HITL) scegli', kind: 'answer', note: 'A' }, { text: '(HITL) b', kind: 'done', note: '' }]);
  for (const f of fs.readdirSync(wdir)) fs.rmSync(path.join(wdir, f));
  const ok = await post({ project: 'sumisura', number: 221, action: 'comment', text: 'ciao' });
  assert.equal(ok.status, 202);
  const wid = (await ok.json()).id;
  assert.match(wid, /^[a-f0-9]{16}$/);
  const rq = JSON.parse(fs.readFileSync(path.join(wdir, `${wid}.req.json`), 'utf8'));
  assert.deepEqual([rq.project, rq.number, rq.action, rq.text], ['sumisura', 221, 'comment', 'ciao']);
  const wget = async () => (await fetch(`${base}/api/projects-issues/write/${wid}`, { headers: { cookie } })).json();
  assert.deepEqual(await wget(), { done: false });
  fs.writeFileSync(path.join(wdir, `${wid}.res.json`), JSON.stringify({ id: wid, ok: true, msg: 'fatto' }));
  assert.deepEqual(await wget(), { done: true, ok: true, msg: 'fatto' });
  assert.equal((await fetch(`${base}/api/projects-issues/write/0123456789abcdef`, { headers: { cookie } })).status, 404);
  // Rilasci (issue 209): lettura pulita, «Rimanda» solo per un rilascio annunciato, idempotente
  assert.equal((await fetch(`${base}/api/releases`)).status, 401);
  assert.equal((await fetch(`${base}/api/releases/postpone`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: "{}" })).status, 401, "Rimanda senza sessione");
  const rel = await (await fetch(`${base}/api/releases`, { headers: { cookie } })).json();
  assert.deepEqual(Object.keys(rel.projects).sort(), ["altro", "sumisura"]);
  const rpost = p => fetch(`${base}/api/releases/postpone`, { method: "POST", headers: { cookie, origin: base, "content-type": "application/json" }, body: JSON.stringify({ project: p }) });
  for (const p of ["altro", "nope", "../evil", 5]) assert.equal((await rpost(p)).status, 409, "Rimanda " + p);
  assert.deepEqual(fs.readdirSync(rdir), []);
  for (let k = 0; k < 3; k++) assert.equal((await rpost("sumisura")).status, 200);
  assert.deepEqual(fs.readdirSync(rdir), ["sumisura.req.json"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(rdir, "sumisura.req.json"), "utf8")).project, "sumisura");
  assert.equal((await (await fetch(`${base}/api/releases`, { headers: { cookie } })).json()).projects.sumisura.pending, true);
  fs.rmSync(file);
  assert.deepEqual(await (await fetch(`${base}/api/projects-issues`, { headers: { cookie } })).json(), { updated: '', projects: {} });
  console.log('ok tracker-projects-issues');
})().then(() => { cleanup(); process.exit(0); }, e => { console.log('FAIL: ' + (e.stack || e)); cleanup(); process.exit(1); });
