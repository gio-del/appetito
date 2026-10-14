'use strict';
// The tracker server as a black box: two ports, a scratch repo and state dir.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-'));
const REPO = path.join(T, 'repo'), STATE = path.join(T, 'var', 'tracker');
const PORT = 20000 + Math.floor(Math.random() * 20000), CPORT = PORT + 1;
const MAIN = `http://127.0.0.1:${PORT}`, CONF = `http://127.0.0.1:${CPORT}`;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const BRAIN = crypto.randomBytes(24).toString('base64url'), SUGGEST = crypto.randomBytes(24).toString('base64url');
let srv, cookie = '';

function hashPassword(pw) {
  const s = crypto.randomBytes(16), N = 1024, r = 8, p = 1;
  const k = crypto.scryptSync(pw, s, 32, { N, r, p });
  return ['scrypt', N, r, p, s.toString('base64'), k.toString('base64')].join('$');
}
async function req(base, method, p, { body, form, headers = {}, auth } = {}) {
  const h = { ...headers };
  if (body) { h['content-type'] = 'application/json'; }
  if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; }
  if (method !== 'GET') h.origin = h.origin || base;
  if (cookie) h.cookie = cookie;
  if (auth) h.authorization = `Bearer ${auth}`;
  const r = await fetch(base + p, { method, headers: h, redirect: 'manual', body: body ? JSON.stringify(body) : form ? new URLSearchParams(form).toString() : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}

test.before(async () => {
  for (const d of ['open', 'done']) fs.mkdirSync(path.join(REPO, 'issues', d), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'issues', 'open', '001-first.md'), '# First\n\nOpened: 2026-01-01\nBlocked on: -\nStatus: todo\n');
  execFileSync('git', ['init', '-q', REPO]);
  fs.mkdirSync(STATE, { recursive: true });
  fs.writeFileSync(path.join(STATE, 'password'), hashPassword('correct horse battery') + '\n');
  fs.writeFileSync(path.join(STATE, 'brain-token'), sha(BRAIN));
  fs.writeFileSync(path.join(STATE, 'suggest-token'), sha(SUGGEST));
  srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, TRACKER_REPO: REPO, TRACKER_STATE: STATE, TRACKER_PORT: String(PORT), TRACKER_CONFIRM_PORT: String(CPORT),
      TRACKER_ORIGINS: MAIN, TRACKER_CONFIRM_ORIGINS: CONF, APPETITO_STATE: path.join(T, 'var'), TRACKER_SETTINGS: path.join(T, 'settings.env'),
      TRACKER_WORKER_STATUS: path.join(T, 'status.json'), TRACKER_WORKER_REQUEST: path.join(T, 'req.json'), TRACKER_DEPLOY: path.join(T, 'deploy'), TRACKER_REQUESTS: path.join(T, 'requests') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Up to 30 s: the checks run this on a box that may be busy starting a newly deployed service.
  let errs = '', exited = null;
  srv.stderr.on('data', d => { errs += d; process.stderr.write(d); });
  srv.on('exit', c => { exited = c; });
  for (let i = 0; i < 300 && exited === null; i++) { try { await fetch(`${MAIN}/healthz`); await fetch(`${CONF}/healthz`); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
  throw new Error(`server did not start (${exited === null ? 'no answer in 30 s' : `exited ${exited}`}): ${errs.trim().slice(-500) || 'no stderr'}`);
});
test.after(() => { srv?.kill(); fs.rmSync(T, { recursive: true, force: true }); });

test('API needs a session; the login page lives on the confirm origin only', async () => {
  const r = await req(MAIN, 'GET', '/api/issues');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.json.login, `${CONF}/login`);
  assert.strictEqual((await req(MAIN, 'POST', '/api/login', { body: { password: 'correct horse battery' } })).status, 401);
  const page = await req(CONF, 'GET', '/login');
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.doesNotMatch(page.text, /<script/);
});
test('wrong host or origin is refused', async () => {
  const status = await new Promise((resolve, reject) => require('node:http').get({ host: '127.0.0.1', port: PORT, path: '/api/issues', headers: { host: 'evil.example' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject));
  assert.strictEqual(status, 421);
  assert.strictEqual((await req(CONF, 'POST', '/login', { form: { password: 'x' }, headers: { origin: 'http://evil.example' } })).status, 403);
});
test('login on the confirm origin sets a session usable on the main origin', async () => {
  const bad = await req(CONF, 'POST', '/login', { form: { password: 'nope', next: MAIN + '/' } });
  assert.strictEqual(bad.status, 401);
  const ok = await req(CONF, 'POST', '/login', { form: { password: 'correct horse battery', next: 'http://evil.example/' } });
  assert.strictEqual(ok.status, 303);
  assert.strictEqual(ok.headers.get('location'), MAIN + '/', 'next outside our origins is replaced (no open redirect)');
  assert.match(cookie, /^appetito_tracker=/);
  assert.strictEqual((await req(MAIN, 'GET', '/api/issues')).status, 200);
});

let pid;
test('a proposal needs a token, gets Source: from it and stays out of the repo', async () => {
  assert.strictEqual((await req(MAIN, 'POST', '/api/propose', { body: { title: 'x', origin: 'Archive/Inbox/a.md' }, auth: 'x'.repeat(40) })).status, 401);
  const r = await req(MAIN, 'POST', '/api/propose', { body: { title: 'Add a thing', desc: 'Body', origin: 'Archive/Inbox/a.md', source: 'system' }, auth: BRAIN });
  assert.strictEqual(r.status, 201);
  pid = r.json.id;
  const f = fs.readdirSync(path.join(STATE, 'proposed'));
  assert.strictEqual(f.length, 1);
  assert.match(fs.readFileSync(path.join(STATE, 'proposed', f[0]), 'utf8'), /^Source: brain$/m);
  assert.deepStrictEqual(fs.readdirSync(path.join(REPO, 'issues', 'open')), ['001-first.md']);
  const sys = await req(MAIN, 'POST', '/api/propose', { body: { title: 'Daily idea', labels: ['afk'] }, auth: SUGGEST });
  assert.strictEqual(sys.status, 201);
  const idx = await req(MAIN, 'GET', '/api/proposals/index', { auth: SUGGEST });
  assert.deepStrictEqual(idx.json.proposals.map(p => p.title), ['Daily idea'], 'suggest sees only system proposals');
  assert.strictEqual((await req(MAIN, 'GET', '/api/proposals/index', { auth: BRAIN })).status, 401);
});
test('approving a proposal from the API is refused (gate 3c): only the confirm page approves', async () => {
  const d = await req(MAIN, 'GET', `/api/issues/${pid}`);
  for (const body of [{ approve: { status: 'todo' } }, { column: 'todo' }, { column: 'backlog' }]) {
    const r = await req(MAIN, 'PATCH', `/api/issues/${pid}`, { body: { version: d.json.version, ...body } });
    assert.strictEqual(r.status, 403, JSON.stringify(body));
  }
  assert.strictEqual(fs.readdirSync(path.join(STATE, 'proposed')).length, 2);
});
test('the confirm page needs its nonce; with it the proposal lands in issues/open with Approved:', async () => {
  const c = await req(MAIN, 'POST', '/api/confirm', { body: { action: 'approve-proposal', id: pid, status: 'todo', note: 'go' } });
  assert.strictEqual(c.status, 200);
  const url = new URL(c.json.url);
  assert.strictEqual(url.origin, CONF);
  // Without the nonce (what the UI's code could do): refused.
  assert.strictEqual((await req(CONF, 'POST', url.pathname, { form: { nonce: 'guess' } })).status, 403);
  // A token is single-use: the failed attempt above didn't burn it, a fresh GET shows the nonce.
  const page = await req(CONF, 'GET', url.pathname);
  assert.strictEqual(page.status, 200);
  assert.doesNotMatch(page.text, /<script/);
  const nonce = /name="nonce" value="([^"]+)"/.exec(page.text)[1];
  const done = await req(CONF, 'POST', url.pathname, { form: { nonce } });
  assert.strictEqual(done.status, 303);
  const open = fs.readdirSync(path.join(REPO, 'issues', 'open'));
  const f = open.find(x => x !== '001-first.md');
  const text = fs.readFileSync(path.join(REPO, 'issues', 'open', f), 'utf8');
  assert.match(text, /^Approved: \d{4}-\d\d-\d\d$/m);
  assert.match(text, /^Status: todo$/m);
  assert.match(text, /^Source: brain$/m);
  assert.strictEqual((await req(CONF, 'POST', url.pathname, { form: { nonce } })).status, 410, 'used once');
});
test('rejecting a proposal keeps it out of the repo', async () => {
  const list = (await req(MAIN, 'GET', '/api/issues')).json.issues;
  const p = list.find(i => i.state === 'proposed');
  const r = await req(MAIN, 'PATCH', `/api/issues/${p.id}`, { body: { version: p.version, reject: { reason: 'not-now', note: 'later' } } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.state, 'done');
  assert.strictEqual(fs.readdirSync(path.join(STATE, 'rejected')).length, 1);
  assert.ok(!fs.readdirSync(path.join(REPO, 'issues', 'done')).length);
});
test('owner edits write the repo; settings are validated', async () => {
  const r = await req(MAIN, 'POST', '/api/issues', { body: { title: 'Owner work', desc: 'Do it', column: 'todo' } });
  assert.strictEqual(r.status, 201);
  assert.ok(fs.existsSync(path.join(REPO, 'issues', 'open', r.json.file)));
  assert.strictEqual((await req(MAIN, 'POST', '/api/issues', { body: { title: 'x', desc: '## Comments\nsneaky' } })).status, 400);
  fs.writeFileSync(path.join(T, 'settings.env'), '');
  assert.strictEqual((await req(MAIN, 'PUT', '/api/settings', { body: { values: { APPETITO_AUTO_QUOTA_MAX: 5 } } })).status, 400);
  const ok = await req(MAIN, 'PUT', '/api/settings', { body: { values: { APPETITO_UI_LANG: 'it' } } });
  assert.strictEqual(ok.json.lang, 'it');
});
test('a branch waiting for the owner is approved only through the confirm page', async () => {
  fs.mkdirSync(path.join(T, 'deploy'), { recursive: true });
  const s = 'a'.repeat(40);
  fs.writeFileSync(path.join(T, 'deploy', 'agent_002-x.json'), JSON.stringify({ branch: 'agent/002-x', sha: s, state: 'waiting-guard', reason: 'guard/PROTECTED', issue: '002', at: 1 }));
  const d = await req(MAIN, 'GET', '/api/deploy');
  assert.strictEqual(d.json.waiting.length, 1);
  const c = await req(MAIN, 'POST', '/api/confirm', { body: { action: 'approve-branch', branch: 'agent/002-x', sha: s } });
  const u = new URL(c.json.url);
  const page = await req(CONF, 'GET', u.pathname);
  const nonce = /name="nonce" value="([^"]+)"/.exec(page.text)[1];
  assert.strictEqual((await req(CONF, 'POST', u.pathname, { form: { nonce } })).status, 303);
  const reqs = fs.readdirSync(path.join(T, 'requests')).map(f => JSON.parse(fs.readFileSync(path.join(T, 'requests', f), 'utf8')));
  assert.deepStrictEqual(reqs, [{ action: 'approve', branch: 'agent/002-x', sha: s, note: '' }]);
});
