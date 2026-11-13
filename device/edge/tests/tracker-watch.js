// Test of GET /api/watch (issue 290): bearer token only, fresh/stale sources, no issue bodies. Offline.
const { spawn, execFileSync } = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-watch-'));
let srv;
const cleanup = () => { try { srv && srv.kill('SIGKILL'); } catch {} fs.rmSync(tmp, { recursive: true, force: true }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const now = () => Math.floor(Date.now() / 1000);

(async () => {
  const pw = 'pw' + crypto.randomBytes(8).toString('hex');
  const st = path.join(tmp, 'state'), s = crypto.randomBytes(16), N = 1024;
  fs.mkdirSync(st);
  fs.writeFileSync(path.join(st, 'password'), ['scrypt', N, 8, 1, s.toString('base64'), crypto.scryptSync(pw, s, 32, { N, r: 8, p: 1 }).toString('base64')].join('$') + '\n');
  const token = crypto.randomBytes(32).toString('hex'), other = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(st, 'watch-token'), sha(token) + '\n');
  fs.writeFileSync(path.join(st, 'suggest-token'), sha(other) + '\n');
  const repo = path.join(tmp, 'repo');
  for (const d of ['open', 'done', 'proposed']) fs.mkdirSync(path.join(repo, 'issues', d), { recursive: true });
  const issue = (dir, id, title, head, body) => fs.writeFileSync(path.join(repo, 'issues', dir, `${id}-x.md`), `# ${title}\n\nOpened: 2026-01-01\n${head}\n\n${body}\n`);
  issue('open', '001', 'Un titolo molto lungo che supera i trenta caratteri\u0007', 'Blocked on: user (x)\nStatus: todo', 'SEGRETO-CORPO\n- [ ] (HITL) domanda');
  issue('open', '002', 'Normale', 'Blocked on: -\nStatus: todo', 'altro SEGRETO-CORPO');
  issue('proposed', '003', 'Proposta', 'Blocked on: -\nStatus: backlog\nLabels: proposed', 'corpo');
  execFileSync('git', ['-C', repo, 'init', '-q']);
  const ed = path.join(tmp, 'es'); fs.mkdirSync(ed);
  const w = (n, o) => fs.writeFileSync(path.join(ed, n), JSON.stringify(o));
  const fresh = () => {
    w('health.json', { up: ['Syncthing', 'Vaultwarden', 'AdGuard Home', 'Issue tracker', 'Calendario e attività', 'Sumisura'], optional: [], updated: now() });
    w('status.json', { level: 80, status: 'In carica', battery_temp: 25, updated: '00:36' });
    w('ops-auto.json', { checked: now(), code: 'working', current: { id: '290' }, queueTotal: 2, queue: [{ id: '122', title: 'Verifica finale' }, { id: '286', title: 'Avvisi ntfy' }], nextSlot: now() + 600, gates: { paused: false, week: { util: 46 }, five: { util: 12 } } });
    w('prs-to-merge.json', { updated: now(), prs: [{ project: 'sumisura', issue: 228, pr: 248, url: 'https://github.com/x/y/pull/248', title: 'Titolo', reason: 'la PR tocca .github/', since: now() - 3600 }] });
    w('release-gate.json', { updated: now(), projects: { sumisura: { status: 'announced' } } });
    w('projects-issues.json', { updated: '2026-01-01T00:00:00Z', projects: { sumisura: { repo: 'x/y', issues: [
      { number: 243, title: 'Lacune di Master Data', state: 'open', url: 'https://github.com/x/y/issues/243', author: 'o', labels: ['needs-owner'], trust: 'author' },
      { number: 244, title: 'Altra non tua', state: 'open', url: '', author: 'z', labels: ['needs-owner'], trust: '' },
      { number: 245, title: 'Senza etichetta', state: 'open', url: '', author: 'o', labels: [], trust: 'author' }] } } });
    w('project-cd.json', { sumisura: { at: '2026-01-01T10:00:00+0100', paused: false } });
    w('jobs.json', { generated: now(), categories: { second_brain: { jobs: [{ title: 'Salvataggio', status: 'ok', t: now() }] }, backup: { jobs: [{ title: 'Backup password', status: 'error', t: now() }, { title: 'Altro', status: 'late', t: now() }] } } });
  };
  fresh();
  const port = 20000 + crypto.randomInt(20000), base = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, [path.join(__dirname, '..', 'tracker', 'server.js')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
    TRACKER_ORIGINS: base, TRACKER_REPO: repo, TRACKER_STATE: st, TRACKER_PORT: String(port), TRACKER_AUTHOR: 'owner', TRACKER_SETTINGS: path.join(tmp, 's.env'),
    TRACKER_AUTO_STATUS: path.join(ed, 'ops-auto.json'), TRACKER_AUTO_REQUEST: path.join(tmp, 'none'), TRACKER_AUTO_LOG: path.join(tmp, 'none'), TRACKER_AUTO_USAGE: path.join(tmp, 'none'),
    TRACKER_RELEASE_STATE: path.join(ed, 'release-gate.json'), TRACKER_PRS_TO_MERGE: path.join(ed, 'prs-to-merge.json'), TRACKER_JOBS_STATUS: path.join(ed, 'jobs.json'),
    TRACKER_PROJECTS_ISSUES: path.join(ed, 'projects-issues.json'), TRACKER_PROJECT_CD: path.join(ed, 'project-cd.json'), TRACKER_WATCH_HEALTH: path.join(ed, 'health.json'), TRACKER_WATCH_STATUS: path.join(ed, 'status.json') } });
  for (let i = 0; i < 75; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(200); }
  const get = (h = {}) => fetch(`${base}/api/watch`, { headers: { origin: base, ...h } });
  const bearer = t => ({ authorization: `Bearer ${t}` });

  assert.equal((await get()).status, 401, 'no token');
  assert.equal((await get(bearer(crypto.randomBytes(32).toString('hex')))).status, 401, 'wrong token');
  assert.equal((await get(bearer(other))).status, 401, 'proposer token');
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ password: pw }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie, 'login');
  assert.equal((await get({ cookie })).status, 401, 'owner session refused');
  // the watch token opens nothing else
  assert.equal((await fetch(`${base}/api/issues`, { headers: bearer(token) })).status, 401, 'token only for /api/watch');
  assert.equal((await fetch(`${base}/api/propose`, { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: '{}' })).status, 401, 'not a proposer');

  let r = await get(bearer(token));
  assert.equal(r.status, 200);
  const txt = await r.text();
  assert.ok(txt.length < 3000, 'compact: ' + txt.length);
  assert.ok(!/SEGRETO|corpo/.test(txt), 'no issue body');
  let j = JSON.parse(txt);
  assert.deepEqual([j.needs.proposals, j.needs.owner, j.needs.releases, j.needs.down], [1, 3, 1, 1]); // 1 PR da unire a mano + 1 issue locale con passo (HITL) + 1 issue di Project con needs-owner (fidata)
  assert.ok(j.needs.titles.length <= 3 && j.needs.titles.every(t => t.length <= 90 && !/[\x00-\x1f]/.test(t)), 'titles ' + j.needs.titles);
  assert.ok(j.needs.titles.some(t => t.includes('Libreria')), 'service down');
  // per categoria, con gli id del tracker; il titolo lungo non viene più tagliato a 30
  assert.deepEqual(Object.keys(j.needs.items).sort(), ['down', 'owner', 'proposals', 'releases']);
  assert.deepEqual(j.needs.prs.map(x => [x.project, x.pr, x.reason]), [['sumisura', 248, 'la PR tocca .github/']]);
  assert.ok(j.needs.items.owner.includes('sumisura#248 da unire a mano'), 'PR da unire: ' + j.needs.items.owner);
  assert.ok(j.needs.items.owner.some(t => t.startsWith('#001 Un titolo molto lungo che supera i trenta caratteri')), 'id locale: ' + j.needs.items.owner);
  assert.ok(j.needs.items.owner.includes('sumisura#243 Lacune di Master Data') && !j.needs.items.owner.some(t => /#244|#245/.test(t)), 'solo needs-owner fidata: ' + j.needs.items.owner);
  assert.ok(j.needs.items.proposals[0].startsWith('#003 Proposta') && j.needs.items.releases[0] === 'sumisura: annunciato' && j.needs.items.down[0] === 'Libreria');
  assert.ok(Object.values(j.needs.items).every(a => a.length <= 5));
  assert.deepEqual(j.stale, []);
  assert.equal(j.ok, false, 'needs attention');
  assert.equal(j.server.battery, 80);
  assert.equal(j.system.auto.now, '#290');
  assert.equal(j.system.auto.queue, 2);

  // progetti, attività, coda e quota di ops-auto (schermate dell'orologio)
  assert.deepEqual(j.projects, [{ name: 'sumisura', open: 3, owner: 1, installed: 1767258000, paused: false, stale: false }]);
  assert.deepEqual([j.jobs.total, j.jobs.bad], [3, 2]);
  assert.deepEqual(j.jobs.list, ['Backup password: error', 'Altro: late']);
  assert.deepEqual(j.system.auto.queueItems, ['#122 Verifica finale', '#286 Avvisi ntfy']);
  assert.deepEqual([j.system.auto.quota.week, j.system.auto.quota.five, j.system.auto.next > now()], [46, 12, true]);

  // «Avvia ora» dall'orologio: solo con il token, solo POST; mentre lavora rifiuta; poi scrive la richiesta una volta sola
  const run = (h = {}) => fetch(`${base}/api/watch/run`, { method: 'POST', headers: h });
  assert.equal((await run()).status, 401, 'run senza token');
  assert.equal((await run(bearer(other))).status, 401, 'run con token da proponente');
  assert.equal((await run(bearer(token))).status, 409, 'già al lavoro');
  w('ops-auto.json', { checked: now(), code: 'idle', queueTotal: 0, gates: { paused: false } });
  r = await run(bearer(token)); assert.equal(r.status, 202); assert.ok((await r.json()).pending.id, 'richiesta scritta');
  assert.ok(fs.existsSync(path.join(tmp, 'none')), 'file di richiesta');
  assert.equal((await run(bearer(token))).status, 409, 'richiesta già in attesa');
  fresh();

  // everything fine and fresh -> ok
  fs.rmSync(path.join(repo, 'issues', 'open', '001-x.md')); fs.rmSync(path.join(repo, 'issues', 'proposed', '003-x.md'));
  w('prs-to-merge.json', { updated: now(), prs: [] }); w('release-gate.json', { updated: now(), projects: {} }); w('projects-issues.json', { updated: '', projects: {} });
  w('health.json', { up: ['Syncthing', 'Vaultwarden', 'AdGuard Home', 'Issue tracker', 'Calendario e attività', 'Sumisura', 'Libreria'], optional: [], updated: now() });
  j = await (await get(bearer(token))).json();
  assert.deepEqual(j.stale, []); assert.equal(j.ok, true, JSON.stringify(j));

  // an old source -> stale, never ok
  w('ops-auto.json', { checked: now() - 7200, code: 'working', queueTotal: 0, gates: { paused: false } });
  j = await (await get(bearer(token))).json();
  assert.deepEqual(j.stale, ['auto']); assert.equal(j.fresh.auto.stale, true); assert.equal(j.ok, false);
  fs.rmSync(path.join(ed, 'health.json'));
  j = await (await get(bearer(token))).json();
  assert.ok(j.stale.includes('health'), 'missing source is stale'); assert.equal(j.needs.down, 0, 'unknown is not down');
  console.log('tracker-watch: ok');
})().then(cleanup, e => { console.error(e); cleanup(); process.exit(1); });
