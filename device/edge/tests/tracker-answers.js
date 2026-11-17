// Test of "Rispondi e sblocca" (issue 173): PATCH {answers} of the tracker on a throwaway repo.
// Offline. From the repo root: device/edge/tests/tracker-answers.sh
const { spawn, execFileSync } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-answers-'));
let srv;
const cleanup = () => { try { srv && srv.kill('SIGKILL'); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const steps3 = '## Esecuzione\n- [x] autonomo\n- [ ] (HITL) crea il token (serve il tuo account)\n- [ ] (HITL) scegli il nome\n- [ ] (HITL) conferma la data\n- [x] (HITL) già fatto';
function fixture() {
  const repo = path.join(tmp, 'repo');
  for (const d of ['open', 'done', 'proposed']) fs.mkdirSync(path.join(repo, 'issues', d), { recursive: true });
  const issue = (id, title, head, body) => fs.writeFileSync(path.join(repo, 'issues', 'open', `${id}-${title.toLowerCase().replace(/\W+/g, '-')}.md`),
    `# ${title}\n\nOpened: 2026-01-01\n${head}\n\n${body}\n`);
  issue('001', 'Tre passi', 'Blocked on: user (token)\nStatus: in-progress', 'Descrizione.\n\n' + steps3);
  issue('002', 'Senza passi', 'Blocked on: user (domanda)\nStatus: todo', 'Una domanda in prosa.');
  issue('003', 'Passo finto', 'Blocked on: issue 001\nStatus: todo', '```\n- [ ] (HITL) in un blocco di codice\n```\n- [ ] (HITL) vero');
  issue('004', 'Epic proposto', 'Blocked on: -\nStatus: todo\nLabels: proposed', 'Epic.');
  issue('005', 'Figlia ops', 'Blocked on: -\nStatus: todo\nParent: 004\nLabels: proposed', 'Figlia.');
  issue('006', 'Figlia brain', 'Blocked on: -\nStatus: todo\nParent: 004\nSource: brain\nOrigin: mail:Archive/x.md\nLabels: proposed', 'Figlia.');
  execFileSync('git', ['-C', repo, 'init', '-q']);
  return repo;
}

(async () => {
  const pw = 'pw' + crypto.randomBytes(8).toString('hex');
  const st = path.join(tmp, 'state'), s = crypto.randomBytes(16), N = 1024;
  fs.mkdirSync(st);
  fs.writeFileSync(path.join(st, 'password'), ['scrypt', N, 8, 1, s.toString('base64'), crypto.scryptSync(pw, s, 32, { N, r: 8, p: 1 }).toString('base64')].join('$') + '\n');
  const port = 20000 + crypto.randomInt(20000), base = `http://127.0.0.1:${port}`;
  const repo = fixture();
  const none = path.join(tmp, 'none');
  fs.writeFileSync(path.join(tmp, 'pi.json'), JSON.stringify({ updated: '2026-10-31', projects: { demo: { repo: 'x/demo', issues: [
    { number: 7, title: 'Domanda sul progetto', state: 'open', url: 'https://github.com/x/demo/issues/7', author: 'o', labels: ['needs-owner'], updated: '2026-10-01', trust: 'author' },
    { number: 8, title: 'Non fidata', state: 'open', url: '', author: 'z', labels: ['needs-owner'], updated: '2026-10-01', trust: 'none' } ] } } }));
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'tracker', 'server.js')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
    TRACKER_ORIGINS: base, TRACKER_REPO: repo, TRACKER_STATE: st, TRACKER_PORT: String(port), TRACKER_AUTHOR: 'owner', TRACKER_SETTINGS: path.join(tmp, 's.env'),
    TRACKER_AUTO_STATUS: none, TRACKER_AUTO_REQUEST: none, TRACKER_AUTO_LOG: none, TRACKER_AUTO_USAGE: none, TRACKER_PROJECTS_ISSUES: path.join(tmp, 'pi.json'), TRACKER_PROJECTS_WRITES: path.join(tmp, 'pw'), TRACKER_SUGGESTIONS: path.join(tmp, 'sugg') } });
  for (let i = 0; i < 75; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(200); }
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: pw }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(login.ok && cookie, 'login');
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const get = async id => (await call('GET', `/api/issues/${id}`)).body;
  const patch = async (id, answers, extra = {}) => { const d = await get(id); return call('PATCH', `/api/issues/${id}`, { version: d.version, answers, ...extra }); };

  // Issue 258: a child that only inherited `proposed` is not a proposal; the parent and an explicit Source stay.
  assert.strictEqual((await get('004')).source, 'brain', 'epic keeps brain source');
  assert.strictEqual((await get('005')).source, '', 'ops child: no source');
  assert.strictEqual((await get('005')).entry, '', 'ops child: no mail badge');
  assert.strictEqual((await get('006')).entry, 'mail', 'explicit Source kept');

  // Three steps, the 2nd one left alone: 1st and 3rd answered -> ticked, unblocked (1st answered).
  let d = await get('001');
  assert.deepEqual(d.hitl.map(x => x.text), ['(HITL) crea il token (serve il tuo account)', '(HITL) scegli il nome', '(HITL) conferma la data']);
  let r = await patch('001', [{ line: d.hitl[0].line, text: d.hitl[0].text, kind: 'done', note: 'fatto dal telefono' },
    { line: d.hitl[2].line, text: d.hitl[2].text, kind: 'answer', note: 'il 5 novembre' }]);
  assert.equal(r.status, 200);
  d = await get('001');
  assert.equal(d.column, 'in-progress');
  assert.deepEqual(d.hitl.map(x => x.text), ['(HITL) scegli il nome']);
  assert.match(d.desc, /- \[x\] \(HITL\) crea il token/);
  assert.match(d.desc, /- \[ \] \(HITL\) scegli il nome/);
  assert.match(d.desc, /- \[x\] \(HITL\) conferma la data/);
  assert.match(d.desc, /- \[x\] autonomo/);
  const c = d.commentList.at(-1);
  assert.equal(c.author, 'owner');
  assert.match(c.text, /\*\*\(HITL\) crea il token \(serve il tuo account\)\*\*\nFatto\. fatto dal telefono/);
  assert.match(c.text, /\*\*\(HITL\) conferma la data\*\*\nil 5 novembre/);

  // Answer to a later step only: the issue stays blocked.
  const f = fs.readFileSync(path.join(repo, 'issues/open/001-tre-passi.md'), 'utf8').replace('Blocked on: -', 'Blocked on: user (nome)');
  fs.writeFileSync(path.join(repo, 'issues/open/001-tre-passi.md'), f);
  fs.writeFileSync(path.join(repo, 'issues/open/004-due.md'), '# Due\n\nOpened: 2026-01-01\nBlocked on: user (x)\nStatus: todo\n\n- [ ] (HITL) uno\n- [ ] (HITL) due\n');
  d = await get('004');
  r = await patch('004', [{ line: d.hitl[1].line, text: d.hitl[1].text, kind: 'answer', note: 'ok' }]);
  assert.equal(r.status, 200);
  d = await get('004');
  assert.equal(d.column, 'blocked');
  assert.match(d.blockedOn, /^user/);
  assert.deepEqual(d.hitl.map(x => x.text), ['(HITL) uno']);

  // The file changed meanwhile: text no longer on that line -> 409 and nothing written.
  d = await get('004');
  r = await patch('004', [{ line: d.hitl[0].line + 1, text: d.hitl[0].text, kind: 'answer', note: 'x' }]);
  assert.equal(r.status, 409);
  r = await patch('004', [{ line: d.hitl[0].line, text: '(HITL) altro testo', kind: 'answer', note: 'x' }]);
  assert.equal(r.status, 409);
  assert.equal((await get('004')).commentList.length, 1);

  // Stale version -> 409.
  d = await get('004');
  r = await call('PATCH', '/api/issues/004', { version: 'x', answers: [{ line: d.hitl[0].line, text: d.hitl[0].text, kind: 'done' }] });
  assert.equal(r.status, 409);

  // Empty answer, bad kind, answers mixed with a desc edit, duplicate line: 400.
  const a0 = { line: d.hitl[0].line, text: d.hitl[0].text };
  assert.equal((await patch('004', [{ ...a0, kind: 'answer', note: '  ' }])).status, 400);
  assert.equal((await patch('004', [{ ...a0, kind: 'boh', note: 'x' }])).status, 400);
  assert.equal((await patch('004', [{ ...a0, kind: 'done' }], { desc: 'altro' })).status, 400);
  assert.equal((await patch('004', [{ ...a0, kind: 'done' }, { ...a0, kind: 'done' }])).status, 400);
  assert.equal((await patch('004', [{ ...a0, kind: 'answer', note: '## titolo' }])).status, 400);

  // No HITL step: one free answer (line null) unblocks; "done" without a step is refused.
  d = await get('002');
  assert.deepEqual(d.hitl, []);
  assert.equal((await patch('002', [{ line: null, kind: 'done' }])).status, 409);
  r = await patch('002', [{ line: null, kind: 'answer', note: 'Sì, vai.' }]);
  assert.equal(r.status, 200);
  d = await get('002');
  assert.equal(d.column, 'todo');
  assert.match(d.commentList.at(-1).text, /^\*\*Risposta\*\*\nSì, vai\.$/);

  // A step inside a code fence is not a step; blocked on an issue stays blocked after the answer.
  d = await get('003');
  assert.deepEqual(d.hitl.map(x => x.text), ['(HITL) vero']);
  assert.equal((await patch('003', [{ line: 1, text: '(HITL) in un blocco di codice', kind: 'done' }])).status, 409);
  assert.equal((await patch('003', [{ line: d.hitl[0].line, text: d.hitl[0].text, kind: 'done' }])).status, 200);
  assert.equal((await get('003')).column, 'blocked');

  // Issue 352: /api/questions = one card per open step; the issue that blocks others comes first; «Non ancora» hides a day.
  let q = (await call('GET', '/api/questions')).body;
  assert.equal(q.cards.length, 3, JSON.stringify(q.cards.map(x => x.key)));
  assert.equal(q.cards[0].issue, '001', 'blocks 003: first');
  assert.equal(q.cards[2].issue, 'demo#7', 'by age: Project card last');
  assert.equal(q.cards[0].blocks, 1);
  assert.equal(q.cards[0].step, '(HITL) scegli il nome');
  assert.equal(q.cards[0].kind, 'local');
  assert.ok(q.cards.filter(x => x.kind === 'local').every(x => x.version && x.title), 'version and title');
  const pc = q.cards.find(x => x.kind === 'project');
  assert.ok(pc && pc.key === 'demo#7' && pc.project === 'demo' && pc.number === 7 && q.cards.filter(x => x.kind === 'project').length === 1, 'trusted needs-owner Project issue only');
  assert.ok(!q.cards.some(x => x.issue === '002'), 'answered issue gone');
  fs.writeFileSync(path.join(repo, 'issues/open/007-solo-prosa.md'), '# Solo prosa\n\nOpened: 2026-01-02\nBlocked on: user (domanda)\nStatus: todo\n\nUna domanda in prosa.\n');
  q = (await call('GET', '/api/questions')).body;
  const prose = q.cards.find(x => x.issue === '007');
  assert.ok(prose && prose.line === null && prose.step === '' && prose.key === '007|*', 'blocked on user without step: one card');
  assert.equal(prose.context, 'Una domanda in prosa.');
  r = await call('POST', '/api/questions/snooze', { key: '004|(HITL) uno' });
  assert.equal(r.status, 200);
  q = (await call('GET', '/api/questions')).body;
  assert.ok(!q.cards.some(x => x.issue === '004') && q.snoozed === 1, 'snoozed hidden');
  assert.equal((await call('POST', '/api/questions/snooze', { key: 'boh' })).status, 404);
  assert.equal((await call('POST', '/api/questions/snooze', { key: 5 })).status, 400);
  const sn = JSON.parse(fs.readFileSync(path.join(st, 'questions-snooze.json'), 'utf8'));
  assert.ok(sn['004|(HITL) uno'] > Date.now() + 23 * 3600e3, 'a day');
  sn['004|(HITL) uno'] = Date.now() - 1000;
  fs.writeFileSync(path.join(st, 'questions-snooze.json'), JSON.stringify(sn));
  assert.ok((await call('GET', '/api/questions')).body.cards.some(x => x.issue === '004'), 'back after a day');
  // Issue 353: the tracker lists the questions for questions-suggest and shows a valid suggestion on the card.
  const sd = path.join(tmp, 'sugg');
  fs.mkdirSync(sd, { recursive: true });
  q = (await call('GET', '/api/questions')).body;
  assert.ok(q.cards.every(x => /^[0-9a-f]{16}$/.test(x.hash) && !x.suggestion), 'hash, no suggestion yet');
  const wanted = JSON.parse(fs.readFileSync(path.join(sd, 'wanted.json'), 'utf8'));
  assert.deepEqual(wanted.map(w => w.hash).sort(), q.cards.map(x => x.hash).sort(), 'wanted.json = the live cards');
  const c0 = q.cards[0];
  fs.writeFileSync(path.join(sd, c0.hash + '.json'), JSON.stringify({ answer: 'Sì\u0007, procedi.', why: 'Non cambia nulla.', model: 'sonnet', at: 1 }));
  const c1 = q.cards[1];
  fs.writeFileSync(path.join(sd, c1.hash + '.json'), JSON.stringify({ answer: 5, why: 'x' }));
  q = (await call('GET', '/api/questions')).body;
  assert.deepEqual(q.cards.find(x => x.key === c0.key).suggestion, { answer: 'Sì , procedi.', why: 'Non cambia nulla.', model: 'sonnet' });
  assert.ok(!q.cards.find(x => x.key === c1.key).suggestion, 'invalid suggestion ignored');
  // Issue 401: the AI's latest "Per te" section replaces the old intro; newer than the owner's comment -> labelled; Risk-accepted in the future is no question.
  const iss = (n, head, body) => fs.writeFileSync(path.join(repo, 'issues/open', n + '.md'), `# ${n}\n\nOpened: 2026-01-03\n${head}\n\n${body}\n`);
  iss('401-ripropone', 'Blocked on: user (scelta)\nStatus: todo', 'Testo vecchio.\n\n## Per te (2026-11-01)\nPrima spiegazione.\n\n## Per te (2026-11-03)\nLa tua condizione non vale: scegli a o b.\n\n## Esecuzione\n- [ ] (HITL) scegli a o b (perche)\n\n## Comments\n\n### 2026-11-03 07:55 (owner)\nSolo se automatico.\n');
  iss('402-senza-nuova', 'Blocked on: user (scelta)\nStatus: todo', 'Testo vecchio.\n\n## Esecuzione\n- [ ] (HITL) scegli c (perche)\n\n## Comments\n\n### 2026-11-03 07:55 (owner)\nOk.\n');
  iss('403-rischio', 'Blocked on: user (avviso senza versione corretta)\nStatus: backlog\nRisk-accepted: 2999-01-01', 'Rischio accettato.');
  q = (await call('GET', '/api/questions')).body;
  const c401 = q.cards.find(x => x.issue === '401'), c402 = q.cards.find(x => x.issue === '402');
  assert.ok(c401.ai && c401.ai.date === '2026-11-03' && c401.ai.newer, 'AI reply flagged');
  assert.ok(c401.context.startsWith('La tua condizione non vale') && !c401.context.includes('Testo vecchio'), c401.context);
  assert.equal(c402.ai, null);
  assert.equal(c402.context, 'Testo vecchio.');
  assert.ok(!q.cards.some(x => x.issue === '403'), 'Risk-accepted in the future: no card');
  assert.ok(!JSON.stringify(q.cards).includes('Claude'), 'no Claude in card texts');
  assert.ok(!/Claude/.test(fs.readFileSync(path.join(__dirname, '..', 'tracker', 'public', 'domande.js'), 'utf8')), 'no Claude in domande.js');
  console.log('ok tracker-answers');
})().then(() => { cleanup(); process.exit(0); }, e => { console.log('FAIL: ' + (e.stack || e)); cleanup(); process.exit(1); });
