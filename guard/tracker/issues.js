'use strict';
// Issue files (issues/{open,done,proposed}/NNN-slug.md, format in issues/README.md): parser/serializer
// shared by the tracker (server.js) and the housekeeping rules (issue 033), which run both in the
// tracker after every edit and as `issues-housekeep [REPO]` (/usr/local/bin, run as $HS_USER by
// issues-autocommit and the deploy), so closes made with git mv by Claude are seen too.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FIELD_RE = /^([A-Z][A-Za-z -]{0,30}):(?: (.*))?$/;
const COMMENTS_RE = /^## Comments\s*$/;
const COMMENT_RE = /^### (\d{4}-\d\d-\d\d(?: \d\d:\d\d)?) \((.{1,60})\)\s*$/;

// Splits "# Title / blank / Key: value lines / blank / body" and pulls the final
// "## Comments" section out of the body.
function parse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  const skipBlank = () => { while (i < lines.length && !lines[i].trim()) i++; };
  skipBlank();
  let title = '';
  if (/^# /.test(lines[i] || '')) { title = lines[i].slice(2).trim(); i++; }
  skipBlank();
  const fields = [];
  for (let m; i < lines.length && (m = FIELD_RE.exec(lines[i])); i++) fields.push([m[1], (m[2] || '').trim()]);
  skipBlank();
  const body = lines.slice(i);
  // Locate "## Comments" outside code fences; it runs to the next "## " heading.
  let start = -1, end = body.length, fence = false;
  for (let j = 0; j < body.length; j++) {
    if (/^\s*```/.test(body[j])) fence = !fence;
    if (fence) continue;
    if (start < 0 && COMMENTS_RE.test(body[j])) start = j;
    else if (start >= 0 && /^## /.test(body[j])) { end = j; break; }
  }
  const comments = [];
  let desc = body;
  if (start >= 0) {
    desc = [...body.slice(0, start), ...body.slice(end)];
    let cur = null;
    for (const l of body.slice(start + 1, end)) {
      const m = COMMENT_RE.exec(l);
      if (m) { cur = { date: m[1], author: m[2], text: '' }; comments.push(cur); }
      else if (cur) cur.text += l + '\n';
    }
    for (const c of comments) c.text = c.text.trim();
  }
  return { title, fields, desc: desc.join('\n').trim(), comments };
}

function serialize(p) {
  let out = `# ${p.title}\n\n`;
  if (p.fields.length) out += p.fields.map(([k, v]) => (v ? `${k}: ${v}` : `${k}:`)).join('\n') + '\n\n';
  if (p.desc) out += p.desc.trim() + '\n';
  if (p.comments.length) {
    out += (p.desc ? '\n' : '') + '## Comments\n';
    for (const c of p.comments) out += `\n### ${c.date} (${c.author})\n${c.text.trim()}\n`;
  }
  return out;
}

const getField = (p, k) => (p.fields.find(([n]) => n.toLowerCase() === k.toLowerCase()) || [])[1];
function setField(p, k, v) {
  const f = p.fields.find(([n]) => n.toLowerCase() === k.toLowerCase());
  if (v === undefined || v === null) { p.fields = p.fields.filter(x => x !== f); return; }
  if (f) { f[1] = v; return; }
  // Closed goes right after Opened, as in the hand-written files.
  const at = k === 'Closed' ? p.fields.findIndex(([n]) => n === 'Opened') : -1;
  if (at >= 0) p.fields.splice(at + 1, 0, [k, v]); else p.fields.push([k, v]);
}

const pad = n => String(n).padStart(2, '0');
function now() {
  const d = new Date();
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

const FILE_RE = /^(\d{3,})-([a-z0-9-]+)\.md$/;

// ---------- housekeeping (issue 033) ----------

const UNTICKED_RE = /^\s*[-*] \[ \]/m;
// "issue 030", "issue 030, 031", "issues 030 and 031" (optionally "#030", a trailing "(why)").
const BLOCKED_BY_RE = /^issues?\s+(#?\d{3,}(?:\s*(?:,|&|and|e)\s*#?\d{3,})*)\s*(?:\(.*\))?$/i;

function blockers(v) {
  const m = BLOCKED_BY_RE.exec((v || '').trim());
  return m ? m[1].match(/\d{3,}/g) : null;
}

function writeAtomic(full, text) {
  const tmp = path.join(path.dirname(full), `.tracker-tmp-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(tmp, text, { mode: 0o664 });
  try { fs.renameSync(tmp, full); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
}

function readAll(repo, states = ['open', 'done', 'proposed']) {
  const out = [];
  for (const state of states) {
    const dir = path.join(repo, 'issues', state);
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const file of names) {
      const m = FILE_RE.exec(file);
      if (!m) continue;
      const full = path.join(dir, file);
      try { out.push({ id: m[1], state, file, full, p: parse(fs.readFileSync(full, 'utf8')) }); } catch {}
    }
  }
  return out;
}

function addComment(p, author, text) {
  const t = now();
  p.comments.push({ date: `${t.date} ${t.time}`, author, text });
}

// Deterministic, idempotent rules (no Claude):
// 1. an open issue labelled "epic", Blocked on "-", no unticked "- [ ]" step, with >=1 child and every
//    child in done/ -> moved to done/ with Closed + a comment;
// 2. an open issue "Blocked on: issue NNN[, MMM]" whose blockers are all in done/ -> "Blocked on: -" + a comment.
// Returns the actions taken, one line each.
function housekeep(repo, author = 'sistema') {
  const log = [];
  for (let round = 0; round < 10; round++) {
    const all = readAll(repo);
    const done = new Set(all.filter(i => i.state === 'done').map(i => i.id));
    let changed = false;
    for (const i of all.filter(x => x.state === 'open')) {
      const labels = (getField(i.p, 'Labels') || '').split(',').map(s => s.trim().toLowerCase());
      const blocked = (getField(i.p, 'Blocked on') || '-').trim();
      if (labels.includes('epic') && /^-/.test(blocked) && !UNTICKED_RE.test(i.p.desc)) {
        const kids = all.filter(c => (getField(c.p, 'Parent') || '').trim() === i.id).map(c => c.id).sort();
        if (kids.length && kids.every(k => done.has(k))) {
          if (!getField(i.p, 'Closed')) setField(i.p, 'Closed', now().date);
          setField(i.p, 'Blocked on', '-');
          addComment(i.p, author, `Chiusa in automatico: tutte le sotto-issue completate (${kids.join(', ')}).`);
          writeAtomic(path.join(repo, 'issues', 'done', i.file), serialize(i.p));
          fs.unlinkSync(i.full);
          log.push(`closed epic ${i.id} (children ${kids.join(', ')})`);
          changed = true;
          continue;
        }
      }
      const ids = blockers(blocked);
      if (ids && ids.every(k => done.has(k))) {
        setField(i.p, 'Blocked on', '-');
        addComment(i.p, author, `Sbloccata: ${ids.join(', ')} ${ids.length > 1 ? 'chiuse' : 'chiusa'}.`);
        writeAtomic(i.full, serialize(i.p));
        log.push(`unblocked ${i.id} (${ids.join(', ')} done)`);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return log;
}

// ---------- relations and duplicates (issue 058) ----------
// `Related: NNN[, MMM]` (symmetric, stored on one side), `Duplicate of: NNN` (on the closed duplicate),
// `Possible-duplicate: NNN` (set by the tracker on a proposal). The other side is always derived.

const idList = v => [...new Set((v || '').match(/\d{3,}/g) || [])];

// Deterministic similarity (no Claude): TF-IDF cosine of normalised tokens (accents stripped, stop words
// dropped, first 6 letters as a crude stem shared by it/en: propos-te/-als, verifi-ca/-cation), title
// weighted 0.6 and description 0.4. IDF comes from the corpus, so words every issue uses count little.
const STOP = new Set(('the and for with from into that this then than are was were has have not but all any its our out per one ' +
  'two can may must when what who why how use used also only each more none just via issue issues after before new ' +
  'nuova nuovo il lo la le gli un una uno di da del della dei delle degli al alla ai alle agli nel nella nei nelle con ' +
  'per tra fra che chi non come dopo prima sul sulla sui sulle dal dalla dai dalle anche solo più sono essere ogni ' +
  'quando cosa questo questa quello quella se ma').split(' '));
const SYNONYM = { check: 'verifi', verify: 'verifi', controllo: 'verifi', controllare: 'verifi', test: 'verifi' };
const SIMILAR_MIN = 0.25;
const DONE_DAYS = 60;

function tokens(s) {
  return (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).map(w => SYNONYM[w] || w.slice(0, 6));
}
function vectors(texts) {
  const counts = texts.map(t => { const m = new Map(); for (const w of tokens(t)) m.set(w, (m.get(w) || 0) + 1); return m; });
  const df = new Map();
  for (const m of counts) for (const w of m.keys()) df.set(w, (df.get(w) || 0) + 1);
  return counts.map(m => {
    const v = new Map(); let n = 0;
    for (const [w, c] of m) { const x = (1 + Math.log(c)) * Math.log((counts.length + 1) / df.get(w)); v.set(w, x); n += x * x; }
    return { v, n: Math.sqrt(n) };
  });
}
const cosine = (a, b) => { let s = 0; for (const [w, x] of a.v) { const y = b.v.get(w); if (y) s += x * y; } return a.n && b.n ? s / (a.n * b.n) : 0; };
// docs: [{title, desc}] -> score(i, j).
function similarity(docs) {
  const T = vectors(docs.map(d => d.title)), B = vectors(docs.map(d => (d.desc || '').slice(0, 4000)));
  return (i, j) => 0.6 * cosine(T[i], T[j]) + 0.4 * cosine(B[i], B[j]);
}

// Issues a new one is compared with: open, (proposed,) and done in the last 60 days.
function corpus(repo, withProposed, nowMs = Date.now()) {
  return readAll(repo, withProposed ? ['open', 'proposed', 'done'] : ['open', 'done']).filter(i => {
    if (i.state !== 'done') return true;
    const c = Date.parse(getField(i.p, 'Closed') || '');
    return !(c < nowMs - DONE_DAYS * 86400e3);
  });
}

// Candidates for "is this new title/body a duplicate?", best first: [{id, state, title, score}].
// A closed duplicate (`Duplicate of: NNN`) lends its score to NNN, which ranks first on a tie: NNN is
// where the work went, even once its own text has drifted away from the duplicate's (issue 059).
function similar(all, title, desc, min = SIMILAR_MIN) {
  const score = similarity([{ title, desc }, ...all.map(i => ({ title: i.p.title, desc: i.p.desc }))]);
  const res = all.map((i, k) => ({ id: i.id, state: i.state, title: i.p.title, score: Math.round(score(0, k + 1) * 100) / 100,
    dupOf: idList(getField(i.p, 'Duplicate of'))[0] }));
  const byId = new Map(res.map(x => [x.id, x]));
  for (const x of res) { const c = x.dupOf && byId.get(x.dupOf); if (c && c.score < x.score) c.score = x.score; }
  return res.filter(x => x.score >= min).sort((a, b) => b.score - a.score || !!a.dupOf - !!b.dupOf)
    .map(({ dupOf, ...x }) => x);
}

// Pairs of open issues that look like the same work. Already linked pairs don't count (parent/child,
// Blocked on, Related, Duplicate of), nor monitor issues (deduplicated by Fingerprint) or epics.
function duplicatePairs(all, min = SIMILAR_MIN) {
  const score = similarity(all.map(i => ({ title: i.p.title, desc: i.p.desc })));
  const links = new Set();
  const link = (a, b) => { links.add(`${a}-${b}`); links.add(`${b}-${a}`); };
  for (const i of all) {
    for (const f of ['Parent', 'Related', 'Duplicate of']) for (const o of idList(getField(i.p, f))) link(i.id, o);
    for (const o of blockers(getField(i.p, 'Blocked on')) || []) link(i.id, o);
  }
  const out = [];
  const eligible = all.map((i, k) => [i, k]).filter(([i]) => {
    if (i.state !== 'open') return false;
    const labels = (getField(i.p, 'Labels') || '').split(',').map(s => s.trim().toLowerCase());
    return !labels.includes('monitor') && !labels.includes('epic');
  });
  for (let a = 0; a < eligible.length; a++) for (let b = a + 1; b < eligible.length; b++) {
    const [x, i] = eligible[a], [y, j] = eligible[b];
    if (links.has(`${x.id}-${y.id}`)) continue;
    const s = score(i, j);
    if (s >= min) out.push([x.id, y.id].sort().concat(Math.round(s * 100) / 100));
  }
  return out;
}

// ---------- shape rules (issue 034, issues/README.md "Shape rules") ----------

const UNTICKED_LINE_RE = /^\s*[-*] \[ \]/;
const STATUSES = ['backlog', 'todo', 'in-progress'];
const EPIC_GRACE_MS = 3600e3; // a freshly written epic gets an hour to receive its children

// Checks the open issues against the shape rules (proposals are never read: only their ids count as
// existing). Returns one finding per problem: { id, ids (issues involved), rule, fp (stable, for
// hs-monitor), msg (Italian) }.
function lint(repo, nowMs = Date.now()) {
  const all = readAll(repo).filter(i => i.state !== 'proposed');
  const ids = new Set(all.map(i => i.id));
  try { for (const f of fs.readdirSync(path.join(repo, 'issues', 'proposed'))) { const m = FILE_RE.exec(f); if (m) ids.add(m[1]); } } catch {}
  const parentOf = new Map(all.map(i => [i.id, (getField(i.p, 'Parent') || '').trim()]));
  const out = [];
  const add = (i, rule, msg) => out.push({ id: i.id, ids: [i.id], rule, fp: `lint-${rule}-${i.id}`, msg });
  for (const i of all.filter(x => x.state === 'open')) {
    const labels = (getField(i.p, 'Labels') || '').split(',').map(s => s.trim().toLowerCase());
    const blocked = (getField(i.p, 'Blocked on') || '-').trim();
    const unticked = i.p.desc.split('\n').filter(l => UNTICKED_LINE_RE.test(l));
    if (labels.includes('epic')) {
      if (unticked.length) add(i, 'epic-work', `Epic ${i.id} contiene lavoro: spostalo in sotto-issue`);
      const kids = all.filter(c => parentOf.get(c.id) === i.id);
      let age = Infinity; try { age = nowMs - fs.statSync(i.full).mtimeMs; } catch {}
      if (!kids.length && age > EPIC_GRACE_MS) add(i, 'epic-no-children', `Epic ${i.id} senza sotto-issue`);
    }
    const status = (getField(i.p, 'Status') || '').trim().toLowerCase();
    if (!status) add(i, 'no-status', `Issue ${i.id} senza Status`);
    else if (!STATUSES.includes(status)) add(i, 'no-status', `Issue ${i.id}: Status «${status}» non valido (backlog, todo, in-progress)`);
    if (/^user\b/i.test(blocked) && unticked.some(l => !/\(HITL\)/.test(l)))
      add(i, 'hidden-work', `Issue ${i.id}: passi automatizzabili dietro un blocco dell'owner`);
    const bl = blockers(blocked);
    const missing = (bl || []).filter(k => !ids.has(k));
    if (missing.length) add(i, 'blocker-missing', `Issue ${i.id}: Blocked on nomina issue inesistenti (${missing.join(', ')})`);
    const par = parentOf.get(i.id);
    if (par) {
      if (!/^\d{3,}$/.test(par) || !ids.has(par)) add(i, 'parent-bad', `Issue ${i.id}: Parent ${par} non esiste`);
      else if (par === i.id || parentOf.get(par)) add(i, 'parent-bad', `Issue ${i.id}: Parent ${par} è a sua volta una sotto-issue (un solo livello)`);
    }
  }
  // Possible duplicates (issue 058): one finding per pair, gone once one closes or they get `Related:`.
  for (const [a, b] of duplicatePairs(all)) out.push({ id: a, ids: [a, b], rule: 'possible-duplicate', fp: `lint-possible-duplicate-${a}-${b}`,
    msg: `Issue ${a} e ${b}: possibile duplicato (unisci con Duplicate of, o collega con Related se sono lavori diversi)` });
  return out;
}

// ---------- stale backlog (issue 063) ----------
// A backlog issue is stale when nobody decided on it for HS_BACKLOG_STALE_DAYS days. Its clock is the
// latest of `Backlog-reviewed:` (written by the tracker's «Tieni in backlog»), the last commit touching the
// file (stands in for "when it got Status: backlog") and `Opened:`. Deterministic, no Claude, no lint.

const dayMs = s => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec((s || '').trim()); return m ? new Date(+m[1], m[2] - 1, +m[3]).getTime() : NaN; };

// `git log --format=%x01%cI --name-only -- issues/open` -> Map file name -> ISO date of its last commit.
function parseGitDates(out) {
  const dates = new Map();
  let cur = '';
  for (const l of (out || '').split('\n')) {
    if (l.startsWith('\x01')) cur = l.slice(1).trim();
    else if (l.trim() && cur) { const f = path.basename(l.trim()); if (!dates.has(f)) dates.set(f, cur); }
  }
  return dates;
}
const GIT_DATES_ARGS = ['log', '--format=%x01%cI', '--name-only', '--', 'issues/open'];
function gitDates(repo) {
  try {
    return parseGitDates(require('node:child_process').execFileSync('git', ['-C', repo, '-c', `safe.directory=${repo}`, ...GIT_DATES_ARGS],
      { encoding: 'utf8', timeout: 20000, maxBuffer: 16 << 20, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }));
  } catch { return new Map(); }
}

// Whole days since the last decision on a backlog issue (null if its clock has no date at all).
function backlogAge(reviewed, opened, gitIso, nowMs = Date.now()) {
  const t = Math.max(...[dayMs(reviewed), Date.parse(gitIso || ''), dayMs(opened)].filter(x => !Number.isNaN(x)));
  return Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86400e3)) : null;
}
const isBacklog = (state, p) => state === 'open' && (getField(p, 'Status') || '').trim().toLowerCase() === 'backlog' && /^-/.test((getField(p, 'Blocked on') || '-').trim());

// items: [{id, state, file, p}] (as readAll) -> [{id, title, days}] for the backlog issues idle >= `days`, oldest first.
function staleBacklog(items, days, dates = new Map(), nowMs = Date.now()) {
  return items.filter(i => isBacklog(i.state, i.p)).map(i => ({ id: i.id, title: i.p.title, days: backlogAge(getField(i.p, 'Backlog-reviewed'), getField(i.p, 'Opened'), dates.get(i.file), nowMs) }))
    .filter(x => x.days !== null && x.days >= days).sort((a, b) => b.days - a.days || a.id.localeCompare(b.id));
}

module.exports = { backlogAge, staleBacklog, parseGitDates, gitDates, GIT_DATES_ARGS, readAll, parse, serialize, getField, setField, now, FILE_RE, COMMENTS_RE, housekeep, blockers, lint, idList, similar, corpus };

// CLI: `issues.js [REPO]` runs the housekeeping; `issues.js --lint [REPO]` prints the lint findings as JSON;
// `issues.js --similar TITLE [BODY]` (REPO from $ISSUES_REPO) prints open/done issues similar to it, best
// first (proposals are left out: their text is untrusted and this runs in the ops session).
if (require.main === module && process.argv[2] === '--similar') {
  const repo = process.env.ISSUES_REPO || path.join(process.env.HOME || '', 'home-server');
  for (const c of similar(corpus(repo, false), process.argv[3] || '', process.argv[4] || ''))
    console.log(`${c.id}\t${c.score.toFixed(2)}\t${c.state}\t${c.title}`);
} else if (require.main === module) {
  const lintMode = process.argv[2] === '--lint';
  const repo = process.argv[lintMode ? 3 : 2] || path.join(process.env.HOME || '', 'home-server');
  if (lintMode) console.log(JSON.stringify(lint(repo), null, 1));
  else for (const l of housekeep(repo)) console.log(l);
}
