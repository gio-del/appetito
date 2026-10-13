'use strict';
// appetito tracker: a Linear-style board over the server repo's issues/{open,done}/*.md, plus the
// pending proposals, the worker's live state and the deploy runner's waiting branches.
// The markdown files stay the source of truth (the agent edits them too, on its branches); this
// service reads/writes them atomically (temp + rename) and reads git history. Root's deploy runner
// commits issue edits. No npm dependencies on purpose.
//
// This server is under guard/: it is the one place that turns the owner's taps into approvals, so
// the agent can't change it without the owner. The UI it serves (core/tracker/public) is not:
// that is why everything sensitive happens on a second origin (TRACKER_CONFIRM_PORT) whose pages
// are rendered here, carry no script, and hold a one-time nonce the UI's code can't read:
//   - login and first password (the password never touches the UI's code);
//   - approving a proposal (it becomes work for the agent);
//   - approving a branch that waits for the owner (a change to guard/, or any change with the
//     merge gate set to `approve`).
//
// Env: TRACKER_REPO (required), TRACKER_STATE (password, sessions, tokens, proposals),
// TRACKER_PORT (8080), TRACKER_CONFIRM_PORT (8081), TRACKER_ORIGINS and TRACKER_CONFIRM_ORIGINS
// (comma-separated origins the browser uses for each, e.g. https://box.tailnet.ts.net and
// https://box.tailnet.ts.net:8443), TRACKER_PUBLIC (UI dir), TRACKER_AUTHOR (name on comments),
// TRACKER_SETTINGS, TRACKER_WORKER_STATUS, TRACKER_WORKER_REQUEST, TRACKER_DEPLOY (runner's
// branch states), TRACKER_REQUESTS (requests for the runner), APPETITO_MERGE_GATE (shown only).
//
// Proposals: two proposers may POST /api/propose with a bearer token: the second brain (user brain,
// reads untrusted material; sha256 in $TRACKER_STATE/brain-token) and the daily suggestions (user
// agent; sha256 in $TRACKER_STATE/suggest-token). Which token authenticated decides `Source:
// brain|system`, never the request body. Proposals wait in $TRACKER_STATE/proposed/, which the agent
// can't read; approval moves them into issues/open/ with `Approved:` (only this server writes it,
// the deploy runner rejects agent branches that touch it).
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const REPO = process.env.TRACKER_REPO;
if (!REPO) { console.error('TRACKER_REPO not set'); process.exit(1); }
const STATE = process.env.TRACKER_STATE || '/var/lib/appetito/tracker';
const PORT = Number(process.env.TRACKER_PORT || 8080);
const CPORT = Number(process.env.TRACKER_CONFIRM_PORT || 8081);
const list = v => (v || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
const ORIGINS = list(process.env.TRACKER_ORIGINS || `http://127.0.0.1:${PORT}`);
const CORIGINS = list(process.env.TRACKER_CONFIRM_ORIGINS || `http://127.0.0.1:${CPORT}`);
const HOSTS = ORIGINS.map(o => new URL(o).host);
const CHOSTS = CORIGINS.map(o => new URL(o).host);
const AUTHOR = process.env.TRACKER_AUTHOR || 'owner';
const PUBLIC = process.env.TRACKER_PUBLIC || path.join(__dirname, '..', '..', 'core', 'tracker', 'public');
const DIRS = {
  open: path.join(REPO, 'issues', 'open'), done: path.join(REPO, 'issues', 'done'),
  proposed: path.join(STATE, 'proposed'), rejected: path.join(STATE, 'rejected'),
};
const WORKER_STATUS = process.env.TRACKER_WORKER_STATUS || '/var/lib/appetito/worker/status.json';
const WORKER_REQUEST = process.env.TRACKER_WORKER_REQUEST || '/var/lib/appetito/worker-request/request.json';
const DEPLOY = process.env.TRACKER_DEPLOY || '/var/lib/appetito/deploy/branches';
const REQUESTS = process.env.TRACKER_REQUESTS || '/var/lib/appetito/requests';
const GATE = process.env.APPETITO_MERGE_GATE === 'approve' ? 'approve' : 'auto';

const STATUSES = ['backlog', 'todo', 'in-progress'];
const COLUMNS = [...STATUSES, 'blocked', 'done'];
const PROPOSALS_PER_DAY = { brain: 20, system: 10 };
const PROPOSER_TOKENS = { brain: 'brain-token', system: 'suggest-token' };
// Reject reasons (chips in the drawer, translated by the UI): `Reject-reason:` header + a comment.
const REJECT_REASONS = ['not-interested', 'not-now', 'too-complex', 'already-covered', 'wrong'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'];
const SESSION_DAYS = 90;
const COOKIE = 'appetito_tracker';
const SECURE = ORIGINS.concat(CORIGINS).every(o => o.startsWith('https:'));

// ---------- issue files ----------

const issues = require('./issues');
const { parse, serialize, getField, setField, now, FILE_RE, COMMENTS_RE, housekeep, lint, blockers, idList, similar, corpus, backlogAge, parseGitDates, GIT_DATES_ARGS } = issues;
issues.setProposedDir(DIRS.proposed);

// Who proposed it: `Source:` (set by the tracker from the token). '' = not a proposal.
function sourceOf(p) {
  const s = (getField(p, 'Source') || '').trim();
  return s === 'system' || s === 'brain' ? s : '';
}

// Entry point of a proposal, from `Source:` + `Origin:` only, never the body: 'system' (daily
// suggestions), 'note' (the owner's inbox note archived by the second brain: Archive/Inbox/…),
// 'other' (any other second-brain origin, e.g. forwarded mail: the cautious wording). originPath: the
// vault path behind it, only if it is a plain relative path under Archive/.
function originPathOf(origin) {
  const o = origin.trim().replace(/^mail:/, '');
  if (o.length > 300 || !/^Archive\//.test(o) || /[\x00-\x1f\x7f\\:]/.test(o)) return '';
  return o.split('/').some(seg => seg === '' || seg === '.' || seg === '..') ? '' : o;
}
function entryOf(source, origin) {
  if (source === 'system') return 'system';
  if (source !== 'brain') return '';
  return !/^\s*mail:/.test(origin) && /^Archive\/Inbox\//.test(originPathOf(origin)) ? 'note' : 'other';
}

function model(state, file, text, mtime) {
  const p = parse(text);
  const [, num, slug] = FILE_RE.exec(file);
  const blockedRaw = getField(p, 'Blocked on') || '-';
  const blocked = /^-/.test(blockedRaw.trim()) ? '' : blockedRaw;
  const statusRaw = (getField(p, 'Status') || '').toLowerCase();
  const status = STATUSES.includes(statusRaw) ? statusRaw : 'todo';
  const prioRaw = (getField(p, 'Priority') || '').toLowerCase();
  const parentRaw = (getField(p, 'Parent') || '').trim();
  const tasks = { done: 0, total: 0 };
  for (const m of p.desc.matchAll(/^\s*[-*] \[([ xX])\]/gm)) { tasks.total++; if (m[1] !== ' ') tasks.done++; }
  const origin = getField(p, 'Origin') || '';
  const source = sourceOf(p);
  const labelList = (getField(p, 'Labels') || '').split(',').map(s => s.trim()).filter(Boolean);
  const shown = state === 'rejected' ? 'done' : state;
  return {
    id: num, slug, file, state: shown, title: p.title || slug,
    column: shown === 'done' ? 'done' : shown === 'proposed' ? 'proposed' : blocked ? 'blocked' : status,
    status, blockedOn: blocked,
    priority: PRIORITIES.includes(prioRaw) ? prioRaw : 'none',
    labels: labelList,
    // Same rule as the worker's selector: what "Work on this issue" may start.
    pickable: shown === 'open' && !blocked && !labelList.includes('epic') && (!source || !!getField(p, 'Approved')) &&
      (labelList.includes('monitor') || ['todo', 'in-progress'].includes(statusRaw)),
    parent: /^\d{3,}$/.test(parentRaw) ? parentRaw : '',
    opened: getField(p, 'Opened') || '', closed: getField(p, 'Closed') || '', origin, approved: getField(p, 'Approved') || '',
    source, entry: entryOf(source, origin), originPath: source === 'brain' ? originPathOf(origin) : '',
    rejectReason: getField(p, 'Reject-reason') || '', backlogReviewed: getField(p, 'Backlog-reviewed') || '',
    related: idList(getField(p, 'Related')), duplicateOf: idList(getField(p, 'Duplicate of'))[0] || '',
    possibleDuplicate: idList(getField(p, 'Possible-duplicate'))[0] || '',
    tasks, comments: p.comments.length, updated: mtime,
    version: crypto.createHash('sha256').update(state + '\n' + text).digest('hex').slice(0, 16),
  };
}

async function listFiles() {
  const out = [];
  for (const state of ['open', 'done', 'proposed', 'rejected']) {
    let names = [];
    try { names = await fsp.readdir(DIRS[state]); } catch { continue; }
    for (const file of names) if (FILE_RE.test(file)) out.push({ state, file });
  }
  return out;
}

async function load(state, file) {
  const full = path.join(DIRS[state], file);
  const [text, st] = await Promise.all([fsp.readFile(full, 'utf8'), fsp.stat(full)]);
  return { text, full, rawState: state, issue: model(state, file, text, st.mtime.toISOString()) };
}

async function listIssues() {
  const all = await Promise.all((await listFiles()).map(f => load(f.state, f.file).then(x => x.issue).catch(() => null)));
  // An approved proposal renumbered on approval leaves no copy behind; a stray duplicate id (a
  // monitor issue that took a pending proposal's number) shows the repo's one first.
  const seen = new Set();
  const uniq = all.filter(Boolean).sort((a, b) => b.id.localeCompare(a.id) || (a.state === 'proposed') - (b.state === 'proposed'))
    .filter(i => { const k = `${i.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return withStale(withFamily(uniq), await backlogDates(), await staleAfter());
}

// Stale backlog: `stale` = days without a decision on a Backlog issue, 0 if under the threshold
// (setting APPETITO_BACKLOG_STALE_DAYS) or not in Backlog. Last-commit dates: one `git log` a minute.
let gitDatesCache = { at: 0, dates: new Map() };
async function backlogDates() {
  if (Date.now() - gitDatesCache.at > 60e3) {
    const out = await git(GIT_DATES_ARGS);
    gitDatesCache = { at: Date.now(), dates: out === null ? gitDatesCache.dates : parseGitDates(out) };
  }
  return gitDatesCache.dates;
}
async function staleAfter() { return (await readSettings()).APPETITO_BACKLOG_STALE_DAYS ?? SCHEMA.APPETITO_BACKLOG_STALE_DAYS.default; }
function withStale(all, dates, days) {
  for (const i of all) {
    const age = i.column === 'backlog' ? backlogAge(i.backlogReviewed, i.opened, dates.get(i.file)) : null;
    i.stale = age !== null && age >= days ? age : 0;
  }
  return all;
}

// Sub-issues: only the child stores the relation (`Parent: NNN`); a parent's children are derived.
// `Related:` is shown on both sides, the blocker of `Blocked on: issue NNN` gets `blocks`, the kept
// issue of `Duplicate of:` gets `duplicates`.
function withFamily(all) {
  const byId = new Map(all.map(i => [i.id, i]));
  for (const i of all) { i.children = { done: 0, total: 0 }; i.parentTitle = ''; i.relatedAll = new Set(i.related); i.blocks = []; i.duplicates = []; }
  for (const i of all) {
    for (const r of i.related) byId.get(r)?.relatedAll.add(i.id);
    for (const b of blockers(i.blockedOn) || []) byId.get(b)?.blocks.push(i.id);
    if (i.duplicateOf) byId.get(i.duplicateOf)?.duplicates.push(i.id);
  }
  for (const i of all) i.relatedAll = [...i.relatedAll].filter(r => r !== i.id && byId.has(r)).sort();
  for (const i of all) {
    const par = i.parent && byId.get(i.parent);
    if (!par) continue;
    i.parentTitle = par.title;
    par.children.total++;
    if (i.state === 'done') par.children.done++;
  }
  return all;
}

// One level only: a parent must exist, not be the issue itself and not be a child; an issue with
// children can't get a parent. Throws on a bad link, returns the normalised id ('' = none).
function checkParent(all, id, parent) {
  if (parent === '' || parent === null) return '';
  if (typeof parent !== 'string' || !/^\d{3,}$/.test(parent)) throw bad('invalid parent');
  const par = all.find(i => i.id === parent);
  if (!par) throw bad(`issue #${parent} doesn't exist`);
  if (parent === id) throw bad('an issue can\'t be its own parent');
  if (par.parent) throw bad(`#${parent} is already a sub-issue (one level only)`);
  if (id && all.some(i => i.parent === id)) throw bad(`#${id} already has sub-issues (one level only)`);
  return parent;
}

async function find(id) {
  if (!/^\d{3,}$/.test(id)) return null;
  const files = (await listFiles()).filter(x => x.file.startsWith(id + '-'));
  const f = files.find(x => x.state !== 'proposed') || files[0];
  return f ? load(f.state, f.file) : null;
}

// Atomic write: the tracker may only create/rename entries in the issue dirs (files written by
// others are read-only to it), so never write in place.
async function writeAtomic(full, text) {
  const tmp = path.join(path.dirname(full), `.tracker-tmp-${crypto.randomBytes(6).toString('hex')}`);
  await fsp.writeFile(tmp, text, { mode: 0o664 });
  try { await fsp.rename(tmp, full); } catch (e) { await fsp.unlink(tmp).catch(() => {}); throw e; }
}

// One writer at a time, so read-check-write sequences don't interleave; across processes the
// numbering lock ($APPETITO_STATE/issues-meta/lock, a directory: mkdir is atomic) is shared with
// the deploy runner and the monitor.
let queue = Promise.resolve();
const serial = fn => { const r = queue.then(fn); queue = r.catch(() => {}); return r; };
const META = path.join(process.env.APPETITO_STATE || path.dirname(STATE), 'issues-meta');
const ISSUES_LOCK = path.join(META, 'lock');
async function withNumberLock(fn) {
  await fsp.mkdir(META, { recursive: true }).catch(() => {});
  for (let i = 0; ; i++) {
    try { await fsp.mkdir(ISSUES_LOCK); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let old = false;
      try { old = Date.now() - (await fsp.stat(ISSUES_LOCK)).mtimeMs > 120e3; } catch {}
      if (old || i > 50) await fsp.rmdir(ISSUES_LOCK).catch(() => {});
      await new Promise(r => setTimeout(r, 100));
    }
  }
  try { return await fn(); } finally { await fsp.rmdir(ISSUES_LOCK).catch(() => {}); }
}
// The deploy runner and the monitor can't see pending proposals, so the highest number in use is
// published for them in a world-readable file (they number new issues above it).
const MAX_HINT = path.join(META, 'max');
async function nextId() {
  const nums = (await listFiles()).map(f => parseInt(f.file, 10));
  let hint = 0;
  try { hint = parseInt(await fsp.readFile(MAX_HINT, 'utf8'), 10) || 0; } catch {}
  const id = Math.max(0, hint, ...nums) + 1;
  await fsp.writeFile(MAX_HINT + '.tmp', String(id) + '\n').then(() => fsp.rename(MAX_HINT + '.tmp', MAX_HINT)).catch(e => console.error(`issues max: ${e.message}`));
  return String(id).padStart(3, '0');
}

// ---------- git (read-only) ----------

function git(args) {
  return new Promise(resolve => execFile('git', ['-C', REPO, '-c', `safe.directory=${REPO}`, ...args],
    { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 10000, maxBuffer: 4 << 20 },
    (err, out) => resolve(err ? null : out)));
}

async function history(file, state) {
  if (state === 'proposed') return { commits: [], uncommitted: false };
  const out = await git(['log', '-n', '50', '--format=%h%x1f%aI%x1f%an%x1f%s', '--', `:(glob)issues/*/${file}`]);
  const commits = (out || '').split('\n').filter(Boolean).map(l => {
    const [hash, date, author, subject] = l.split('\x1f');
    return { hash, date, author, subject };
  });
  const st = await git(['status', '--porcelain', '--untracked-files=all', '--', 'issues/']);
  return { commits, uncommitted: !!st && st.split('\n').some(l => l.endsWith('/' + file)) };
}

// ---------- validation ----------

class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = msg => new HttpError(400, msg);

function oneLine(v, max, name) {
  if (typeof v !== 'string' || /[\r\n]/.test(v) || !v.trim() || v.length > max) throw bad(`invalid ${name}`);
  return v.trim();
}
function oneLineOrEmpty(v, max, name) {
  if (typeof v !== 'string' || v.length > max) throw bad(`invalid ${name}`);
  return v.replace(/\s+/g, ' ').trim();
}
function text(v, max, name) {
  if (typeof v !== 'string' || v.length > max) throw bad(`invalid ${name}`);
  return v.replace(/\r\n/g, '\n');
}
function labels(v) {
  if (!Array.isArray(v) || v.length > 10) throw bad('invalid labels');
  const out = [...new Set(v.map(s => typeof s === 'string' ? s.trim().toLowerCase() : ''))];
  if (out.some(s => !/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,29}$/u.test(s))) throw bad('invalid labels');
  return out;
}
const oneOf = (v, l, name) => { if (!l.includes(v)) throw bad(`invalid ${name}`); return v; };
// A body must not smuggle in a section the parser would read as comments, nor the approval fields.
const noComments = s => { if (s.split('\n').some(l => COMMENTS_RE.test(l))) throw bad('"## Comments" is reserved'); return s; };

function slugify(title) {
  return title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'issue';
}
const addLabel = (p, ...extra) => {
  const lab = (getField(p, 'Labels') || '').split(',').map(x => x.trim()).filter(Boolean);
  setField(p, 'Labels', [...new Set([...lab, ...extra])].join(', '));
};

// ---------- mutations ----------

async function createIssue(b) {
  const title = oneLine(b.title, 200, 'title');
  const p = { title, fields: [], desc: noComments(text(b.desc ?? '', 200000, 'description')).trim(), comments: [] };
  const column = oneOf(b.column ?? 'todo', STATUSES.concat('blocked'), 'column');
  const blockedOn = column === 'blocked' ? oneLine(b.blockedOn || 'user', 60, 'blockedOn') : '-';
  setField(p, 'Opened', now().date);
  setField(p, 'Blocked on', blockedOn);
  setField(p, 'Status', column === 'blocked' ? 'todo' : column);
  const prio = oneOf(b.priority ?? 'none', PRIORITIES, 'priority');
  if (prio !== 'none') setField(p, 'Priority', prio);
  const lab = labels(b.labels ?? []);
  if (lab.length) setField(p, 'Labels', lab.join(', '));
  return serial(() => withNumberLock(async () => {
    const id = await nextId();
    if (b.parent !== undefined) { const par = checkParent(await listIssues(), id, b.parent); if (par) setField(p, 'Parent', par); }
    const file = `${id}-${slugify(title)}.md`;
    await writeAtomic(path.join(DIRS.open, file), serialize(p));
    return (await load('open', file)).issue;
  }));
}

// A proposal: always backlog, label "proposed", `Source:` = the proposer whose token authenticated.
// Second brain: Origin: required (the archived inbox item it came from); Parent only another proposal.
// System (daily suggestions): Origin is `suggest <date>`, labels must carry afk or hitl, no Parent.
let proposals = { day: '', brain: 0, system: 0 };
async function proposeIssue(b, source) {
  const day = now().date;
  if (proposals.day !== day) proposals = { day, brain: 0, system: 0 };
  const max = PROPOSALS_PER_DAY[source];
  if (proposals[source] >= max) throw new HttpError(429, `max ${max} proposals a day`);
  const title = oneLine(b.title, 200, 'title');
  const p = { title, fields: [], desc: noComments(text(b.desc ?? '', 200000, 'description')).trim(), comments: [] };
  const lab = ['proposed', ...labels(b.labels ?? []).filter(l => l !== 'proposed')].slice(0, 6);
  if (source === 'system') {
    if (b.parent !== undefined && b.parent !== '') throw bad('system proposals have no parent');
    if (lab.includes('afk') === lab.includes('hitl')) throw bad('labels need exactly one of afk, hitl');
  }
  setField(p, 'Opened', day);
  setField(p, 'Blocked on', '-');
  setField(p, 'Status', 'backlog');
  setField(p, 'Labels', lab.join(', '));
  setField(p, 'Source', source);
  setField(p, 'Origin', source === 'system' ? `suggest ${day}` : oneLine(b.origin, 300, 'origin'));
  return serial(() => withNumberLock(async () => {
    const id = await nextId();
    if (source === 'brain' && b.parent !== undefined && b.parent !== '') {
      const all = await listIssues();
      const par = checkParent(all, id, b.parent);
      if (all.find(i => i.id === par).state !== 'proposed') throw bad('parent must be a proposal');
      setField(p, 'Parent', par);
    }
    // Deterministic duplicate check: the closest open/proposed/recent done issue, shown next to
    // Approve/Reject. Only the id is stored.
    try { const c = similar(corpus(REPO, true), title, p.desc)[0]; if (c) setField(p, 'Possible-duplicate', c.id); } catch (e) { console.error('similar: ' + e.message); }
    await fsp.mkdir(DIRS.proposed, { recursive: true, mode: 0o750 });
    const file = `${id}-${slugify(title)}.md`;
    await writeAtomic(path.join(DIRS.proposed, file), serialize(p));
    proposals[source]++;
    return (await load('proposed', file)).issue;
  }));
}

// Approving moves a proposal into the repo (issues/open/) with `Approved:`; this is reachable only
// from a confirm page. A monitor issue may have taken its number meanwhile: then it gets a new one.
async function approveProposal(id, status, note) {
  return serial(() => withNumberLock(async () => {
    const cur = await find(id);
    if (!cur || cur.rawState !== 'proposed') throw new HttpError(409, 'not a pending proposal');
    const p = parse(cur.text);
    setField(p, 'Status', oneOf(status, ['todo', 'backlog'], 'status'));
    setField(p, 'Blocked on', '-');
    setField(p, 'Approved', now().date);
    const t = now();
    if (note) p.comments.push({ date: `${t.date} ${t.time}`, author: AUTHOR, text: `Approved: ${note}` });
    let file = cur.issue.file;
    const taken = (await listFiles()).some(f => f.state !== 'proposed' && f.file.startsWith(id + '-'));
    if (taken) file = `${await nextId()}-${cur.issue.slug}.md`;
    await writeAtomic(path.join(DIRS.open, file), serialize(p));
    await fsp.unlink(cur.full);
    return (await load('open', file)).issue;
  }));
}

function relatedIds(v, id, all) {
  if (!Array.isArray(v) || v.length > 20) throw bad('invalid related');
  const out = [...new Set(v)];
  for (const r of out) {
    if (typeof r !== 'string' || !/^\d{3,}$/.test(r)) throw bad('invalid related');
    if (r === id) throw bad('an issue can\'t be related to itself');
    if (!all.some(i => i.id === r)) throw bad(`issue #${r} doesn't exist`);
  }
  return out.sort();
}

async function updateIssue(id, b) {
  return serial(async () => {
    const cur = await find(id);
    if (!cur) throw new HttpError(404, 'not found');
    if (b.version !== cur.issue.version) throw new HttpError(409, 'changed meanwhile');
    const isProposal = cur.rawState === 'proposed';
    if (isProposal && (b.approve !== undefined || (b.column !== undefined && b.column !== 'done')))
      throw new HttpError(403, 'approving a proposal needs the confirm page');
    if (cur.rawState === 'rejected' && b.column !== undefined) throw bad('a rejected proposal stays rejected');
    const p = parse(cur.text);
    let state = cur.rawState;
    if (b.title !== undefined) p.title = oneLine(b.title, 200, 'title');
    if (b.desc !== undefined) p.desc = noComments(text(b.desc, 200000, 'description')).trim();
    if (b.priority !== undefined) setField(p, 'Priority', oneOf(b.priority, PRIORITIES, 'priority') === 'none' ? null : b.priority);
    if (b.labels !== undefined) { const l = labels(b.labels); setField(p, 'Labels', l.length ? l.join(', ') : null); }
    const notes = [];
    // Mark as duplicate of… / Reject as duplicate: closed into done with `Duplicate of:` and label
    // "duplicate" (a proposal: also rejected, reason already-covered).
    if (b.duplicateOf !== undefined) {
      if (b.reject !== undefined || b.column !== undefined) throw bad('duplicateOf sets the column');
      if (cur.issue.state === 'done') throw bad('already closed');
      const dup = b.duplicateOf;
      if (typeof dup !== 'string' || !/^\d{3,}$/.test(dup)) throw bad('invalid duplicateOf');
      if (dup === id) throw bad('an issue can\'t duplicate itself');
      const target = (await listIssues()).find(i => i.id === dup);
      if (!target) throw bad(`issue #${dup} doesn't exist`);
      if (target.duplicateOf === id) throw bad(`#${dup} is already a duplicate of #${id}`);
      const note = b.note === undefined ? '' : oneLineOrEmpty(b.note, 1000, 'note');
      addLabel(p, ...(isProposal ? ['rejected', 'duplicate'] : ['duplicate']));
      setField(p, 'Duplicate of', dup);
      if (isProposal) { setField(p, 'Reject-reason', 'already-covered'); notes.push([`Rejected: already covered — duplicate of #${dup}`, note].filter(Boolean).join(' — ')); }
      else notes.push([`Duplicate of #${dup}: closed here, the work continues there.`, note].filter(Boolean).join(' — '));
      b.column = 'done';
    }
    const others = [];
    if (b.related !== undefined) {
      const all = await listIssues();
      const want = relatedIds(b.related, id, all);
      for (const o of all.filter(i => i.related.includes(id) && !want.includes(i.id) && i.state !== 'proposed')) others.push(o.id);
      const mine = want.filter(r => !all.find(i => i.id === r).related.includes(id) || cur.issue.related.includes(r));
      setField(p, 'Related', mine.length ? mine.join(', ') : null);
    }
    if (b.reject !== undefined) {
      if (!isProposal) throw bad('not a proposal');
      if (b.column !== undefined) throw bad('reject sets the column');
      const d = b.reject;
      if (typeof d !== 'object' || d === null || Array.isArray(d)) throw bad('invalid decision');
      const note = d.note === undefined ? '' : oneLineOrEmpty(d.note, 1000, 'note');
      const reason = d.reason === undefined || d.reason === '' ? '' : oneOf(d.reason, REJECT_REASONS, 'reason');
      b.column = 'done';
      addLabel(p, 'rejected');
      if (reason) setField(p, 'Reject-reason', reason);
      if (reason || note) notes.push(['Rejected' + (reason ? `: ${reason}` : ''), note].filter(Boolean).join(' — '));
    }
    // Stale backlog: Move to To do / Keep in backlog (`Backlog-reviewed:`, the clock restarts) /
    // Reject (done, label rejected). Backlog issues only.
    if (b.backlog !== undefined) {
      if (b.reject !== undefined || b.column !== undefined || b.duplicateOf !== undefined) throw bad('backlog sets the column');
      if (cur.issue.column !== 'backlog') throw bad('not in Backlog');
      const d = b.backlog;
      if (typeof d !== 'object' || d === null || Array.isArray(d)) throw bad('invalid decision');
      const note = d.note === undefined ? '' : oneLineOrEmpty(d.note, 1000, 'note');
      const action = oneOf(d.action, ['todo', 'keep', 'reject'], 'action');
      if (action === 'todo') { b.column = 'todo'; if (note) notes.push(`Moved to To do: ${note}`); }
      else if (action === 'keep') { setField(p, 'Backlog-reviewed', now().date); if (note) notes.push(`Kept in backlog: ${note}`); }
      else {
        const reason = d.reason === undefined || d.reason === '' ? '' : oneOf(d.reason, REJECT_REASONS, 'reason');
        b.column = 'done';
        addLabel(p, 'rejected');
        if (reason) setField(p, 'Reject-reason', reason);
        if (reason || note) notes.push(['Rejected' + (reason ? `: ${reason}` : ''), note].filter(Boolean).join(' — '));
      }
    }
    if (b.parent !== undefined || b.column === 'done') {
      const all = await listIssues();
      if (b.parent !== undefined) setField(p, 'Parent', checkParent(all, id, b.parent) || null);
      const open = all.filter(i => i.parent === id && i.state !== 'done').length;
      if (b.column === 'done' && open) throw bad(open === 1 ? 'can\'t close: 1 open sub-issue' : `can't close: ${open} open sub-issues`);
    }
    if (b.column !== undefined) {
      const col = oneOf(b.column, COLUMNS, 'column');
      if (col === 'done') {
        state = isProposal ? 'rejected' : 'done';
        if (!getField(p, 'Closed')) setField(p, 'Closed', now().date);
        setField(p, 'Blocked on', '-');
      } else {
        state = 'open';
        setField(p, 'Closed', null);
        if (col === 'blocked') setField(p, 'Blocked on', oneLine(b.blockedOn || 'user', 60, 'blockedOn'));
        else { setField(p, 'Blocked on', '-'); setField(p, 'Status', col); }
      }
    } else if (b.blockedOn !== undefined && cur.issue.column === 'blocked') {
      setField(p, 'Blocked on', oneLine(b.blockedOn, 60, 'blockedOn'));
    }
    if (b.comment !== undefined) {
      const c = text(b.comment, 20000, 'comment').trim();
      if (!c) throw bad('empty comment');
      if (c.split('\n').some(l => /^##? /.test(l))) throw bad('comments cannot contain # or ## headings');
      notes.push(c.replace(/^### /gm, '#### '));
    }
    const t = now();
    for (const c of notes) p.comments.push({ date: `${t.date} ${t.time}`, author: AUTHOR, text: c });
    if (state === 'rejected') await fsp.mkdir(DIRS.rejected, { recursive: true, mode: 0o750 });
    const target = path.join(DIRS[state], cur.issue.file);
    await writeAtomic(target, serialize(p));
    if (target !== cur.full) await fsp.unlink(cur.full);
    for (const oid of others) {
      const o = await find(oid);
      const op = parse(o.text);
      const rest = idList(getField(op, 'Related')).filter(r => r !== id);
      setField(op, 'Related', rest.length ? rest.join(', ') : null);
      await writeAtomic(o.full, serialize(op));
    }
    // Epic whose last child just closed -> closed; dependants of a closed issue -> unblocked.
    try { for (const l of housekeep(REPO)) console.log('housekeep: ' + l); } catch (e) { console.error('housekeep: ' + e.message); }
    return (await find(id)).issue;
  });
}

// What the daily suggestions may learn from: their own past proposals and the owner's decisions
// (title, state, reason, the owner's note). Never the second brain's proposals (untrusted text).
async function proposalIndex() {
  const out = [];
  for (const f of await listFiles()) {
    let x; try { x = await load(f.state, f.file); } catch { continue; }
    if (x.issue.source !== 'system') continue;
    const p = parse(x.text);
    const note = p.comments.filter(c => c.author === AUTHOR && /^(Approved|Rejected)/.test(c.text)).map(c => c.text.slice(0, 300)).pop() || '';
    out.push({ id: x.issue.id, title: x.issue.title, labels: x.issue.labels,
      decision: f.state === 'proposed' ? 'pending' : f.state === 'rejected' ? 'rejected' : 'approved',
      state: x.issue.state, reason: x.issue.rejectReason, note, opened: x.issue.opened });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---------- auth ----------

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const SESSIONS_FILE = path.join(STATE, 'sessions.json');
let sessions = {};
try { sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch { /* none yet */ }
function saveSessions() {
  const t = Date.now();
  for (const [k, exp] of Object.entries(sessions)) if (exp < t) delete sessions[k];
  fs.writeFileSync(SESSIONS_FILE + '.tmp', JSON.stringify(sessions), { mode: 0o600 });
  fs.renameSync(SESSIONS_FILE + '.tmp', SESSIONS_FILE);
}
function cookieToken(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})`).exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function proposer(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const got = Buffer.from(sha(m[1]), 'hex');
  for (const [source, file] of Object.entries(PROPOSER_TOKENS)) {
    let want;
    try { want = Buffer.from(fs.readFileSync(path.join(STATE, file), 'utf8').trim(), 'hex'); } catch { continue; }
    if (want.length === 32 && crypto.timingSafeEqual(got, want)) return source;
  }
  return null;
}
function authed(req) {
  const t = cookieToken(req);
  const exp = t && sessions[sha(t)];
  return !!exp && exp > Date.now();
}

// Hash format (written by tracker-passwd and the setup page): scrypt$N$r$p$salt_b64$hash_b64
function checkPassword(pw) {
  let line;
  try { line = fs.readFileSync(path.join(STATE, 'password'), 'utf8').trim(); } catch { return false; }
  const [alg, N, r, p, salt, hash] = line.split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(pw).normalize('NFC'), Buffer.from(salt, 'base64'), want.length,
    { N: +N, r: +r, p: +p, maxmem: 256 * +N * +r + (1 << 20) });
  return crypto.timingSafeEqual(want, got);
}
// Global throttle: at most 5 failed logins per 15 minutes (one owner, no reason to allow more).
let failures = [];
function throttled() { failures = failures.filter(t => t > Date.now() - 15 * 60e3); return failures.length >= 5; }
function hashPassword(pw) {
  const s = crypto.randomBytes(16), N = 32768, r = 8, p = 1;
  const k = crypto.scryptSync(pw.normalize('NFC'), s, 32, { N, r, p, maxmem: 256 * N * r + (1 << 20) });
  return ['scrypt', N, r, p, s.toString('base64'), k.toString('base64')].join('$');
}
// One-time setup link (`tracker-passwd --link`): "<sha256 of token> <expiry ms>", deleted once used.
const SETUP_FILE = path.join(STATE, 'setup-token');
function checkSetupToken(token) {
  let hash, exp;
  try { [hash, exp] = fs.readFileSync(SETUP_FILE, 'utf8').trim().split(' '); } catch { return false; }
  if (!/^[0-9a-f]{64}$/.test(hash || '') || !(+exp > Date.now()) || typeof token !== 'string' || token.length > 200) return false;
  return crypto.timingSafeEqual(Buffer.from(sha(token), 'hex'), Buffer.from(hash, 'hex'));
}
function sessionCookie() {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[sha(token)] = Date.now() + SESSION_DAYS * 86400e3;
  saveSessions();
  return `${COOKIE}=${token}; Path=/; HttpOnly;${SECURE ? ' Secure;' : ''} SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

// ---------- worker (live page) ----------

const AUTO_PER_HOUR = 6;
let autoStarts = [];
const readJsonFile = async f => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return null; } };
async function autoStatus() {
  const status = await readJsonFile(WORKER_STATUS);
  const req = await readJsonFile(WORKER_REQUEST);
  const pending = req && (!status || !status.request || status.request.id !== req.id) && Date.now() / 1000 - req.at < 660 ? req : null;
  return { status, pending, now: Math.floor(Date.now() / 1000), lang: await uiLang() };
}
function autoRun(b) { return serial(() => autoRunNow(b)); }
async function autoRunNow(b) {
  let issue = null;
  if (b.issue != null && b.issue !== '') {
    if (typeof b.issue !== 'string' || !/^\d{3,4}$/.test(b.issue)) throw bad('invalid issue');
    const i = (await listIssues()).find(x => x.id === b.issue);
    if (!i) throw new HttpError(404, 'issue not found');
    if (!i.pickable) throw new HttpError(409, 'the worker can\'t pick this issue (open, To do or In progress, not blocked, not an epic)');
    issue = i.id;
  }
  const { status, pending } = await autoStatus();
  if (pending) throw new HttpError(409, 'a request is already waiting');
  if (status && (status.code === 'working' || status.code === 'deploying')) throw new HttpError(409, `already working on #${status.current && status.current.id}`);
  autoStarts = autoStarts.filter(t => t > Date.now() - 3600e3);
  if (autoStarts.length >= AUTO_PER_HOUR) throw new HttpError(429, `at most ${AUTO_PER_HOUR} manual starts an hour`);
  autoStarts.push(Date.now());
  const req = { id: crypto.randomBytes(8).toString('hex'), at: Math.floor(Date.now() / 1000), issue };
  await writeAtomic(WORKER_REQUEST, JSON.stringify(req) + '\n');
  return { ok: true, pending: req };
}

// ---------- deploy runner (waiting branches) ----------

async function deployStates() {
  const out = [];
  let names = [];
  try { names = await fsp.readdir(DEPLOY); } catch {}
  for (const f of names.filter(n => n.endsWith('.json'))) {
    const s = await readJsonFile(path.join(DEPLOY, f));
    if (!s || typeof s.branch !== 'string') continue;
    out.push({ branch: s.branch, sha: s.sha, state: s.state, reason: s.reason || '', issue: s.issue || null, at: s.at });
  }
  return out.sort((a, b) => (b.at || 0) - (a.at || 0));
}
async function deployDiff(branch) {
  if (!/^agent\/[0-9]{3,4}-[a-z0-9-]{1,60}$/.test(branch)) throw bad('invalid branch');
  try { return await fsp.readFile(path.join(DEPLOY, branch.replace(/\//g, '_') + '.diff'), 'utf8'); } catch { return ''; }
}
async function waitingBranch(branch, sha) {
  if (typeof branch !== 'string' || !/^agent\/[0-9]{3,4}-[a-z0-9-]{1,60}$/.test(branch) || typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) throw bad('invalid branch');
  const s = (await deployStates()).find(x => x.branch === branch);
  if (!s || s.sha !== sha || !/^waiting-/.test(s.state)) throw new HttpError(409, 'that change is not waiting any more');
  return s;
}
async function deployRequest(action, branch, sha, note) {
  await fsp.mkdir(REQUESTS, { recursive: true });
  const f = path.join(REQUESTS, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`);
  await writeAtomic(f, JSON.stringify({ action, branch, sha, note: note || '' }) + '\n');
}

// ---------- settings ----------
// Only the keys of settings.schema.json, each checked against its type and range; written as
// KEY=value lines to SETTINGS_FILE, which jobs read through core/bin/appetito-setting. Nothing
// security-relevant is in the schema (the merge gate lives in /etc/appetito/appetito.env).

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.schema.json'), 'utf8'));
const SETTINGS_FILE = process.env.TRACKER_SETTINGS || '/var/lib/appetito/settings.env';
const known = k => Object.hasOwn(SCHEMA, k);
const TEXT_RE = /^[^\x00-\x1f\x7f"'\\/=]{1,64}$/;
const labelOf = k => SCHEMA[k].label.en;
function settingOut(key, v) {
  const s = known(key) && SCHEMA[key];
  if (!s) throw bad(`unknown setting: ${key}`);
  const range = `${labelOf(key)}: invalid value`;
  switch (s.type) {
    case 'bool': if (typeof v !== 'boolean') throw bad(range); return v ? '1' : '0';
    case 'int': if (!Number.isInteger(v) || v < s.min || v > s.max) throw bad(`${labelOf(key)}: from ${s.min} to ${s.max}`); return String(v);
    case 'time': if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad(range); return v;
    case 'enum': if (!s.values.includes(v)) throw bad(range); return v;
    case 'text': if (typeof v !== 'string' || !TEXT_RE.test(v)) throw bad(range); return v;
    default: throw bad(range);
  }
}
function settingIn(key, raw) {
  const s = SCHEMA[key];
  let v;
  if (s.type === 'bool') v = raw === '1' ? true : raw === '0' ? false : null;
  else if (s.type === 'int') v = /^\d{1,6}$/.test(raw) ? Number(raw) : null;
  else v = raw;
  if (v === null) return null;
  try { settingOut(key, v); return v; } catch { return null; }
}
async function readSettings() {
  let t = '';
  try { t = await fsp.readFile(SETTINGS_FILE, 'utf8'); } catch {}
  const set = {};
  for (const l of t.split('\n')) {
    const m = /^([A-Z][A-Z0-9_]{0,40})=(.*)$/.exec(l);
    if (m && known(m[1])) { const v = settingIn(m[1], m[2]); if (v !== null) set[m[1]] = v; }
  }
  return set;
}
async function uiLang() { return (await readSettings()).APPETITO_UI_LANG || SCHEMA.APPETITO_UI_LANG.default; }
async function getSettings() {
  const set = await readSettings();
  return { schema: SCHEMA, values: Object.fromEntries(Object.keys(SCHEMA).map(k => [k, k in set ? set[k] : SCHEMA[k].default])), set: Object.keys(set), gate: GATE, lang: await uiLang() };
}
function saveSettings(b) { return serial(() => saveSettingsNow(b)); }
async function saveSettingsNow(b) {
  if (!b || typeof b.values !== 'object' || b.values === null || Array.isArray(b.values)) throw bad('values missing');
  const set = await readSettings();
  const lines = {};
  for (const [k, v] of Object.entries(set)) lines[k] = settingOut(k, v);
  for (const [k, v] of Object.entries(b.values)) {
    if (!known(k)) throw bad(`unknown setting: ${k}`);
    if (v === null) delete lines[k]; else lines[k] = settingOut(k, v);
  }
  const out = '# Written by the tracker (settings page); read with appetito-setting KEY. Missing key = default.\n' +
    Object.keys(SCHEMA).filter(k => k in lines).map(k => `${k}=${lines[k]}\n`).join('');
  // The file is pre-created by the installer (the unit may write only that path), so write in place.
  await fsp.writeFile(SETTINGS_FILE, out);
  return getSettings();
}

// ---------- confirm origin: login, setup, confirmations ----------
// Server-rendered pages with no script at all (CSP: script-src 'none'). A confirmation has a token
// (in the URL the UI opens) and a nonce that exists only inside the page's form: the UI's code can't
// read a page of another origin, so it can't complete a confirmation by itself.

const pending = new Map(); // token -> {nonce, action, args, summary, back, exp}
function newConfirm(action, args, summary, back) {
  for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
  if (pending.size > 50) throw new HttpError(429, 'too many pending confirmations');
  const token = crypto.randomBytes(18).toString('base64url');
  pending.set(token, { nonce: crypto.randomBytes(18).toString('base64url'), action, args, summary, back, exp: Date.now() + 10 * 60e3 });
  return `${CORIGINS[0]}/confirm/${token}`;
}

const T = {
  en: {
    login: 'Sign in', password: 'Password', enter: 'Sign in', wrong: 'Wrong password', throttled: 'Too many attempts, try again in 15 minutes',
    setup: 'Set the password', setupHelp: 'One-time link. Generate the password with your password manager and save it there, then paste it here twice.',
    newPw: 'New password (at least 12 characters)', repeat: 'Repeat the password', save: 'Save and sign in', mismatch: 'The two passwords differ',
    short: 'The password needs 12 to 200 characters', badLink: 'Invalid, expired or already used link',
    confirm: 'Confirm', cancel: 'Back to the tracker', done: 'Done', expired: 'This confirmation expired or was already used. Go back and try again.',
    approveTitle: 'Approve this proposal?', approveTodo: 'It becomes an issue in To do: the agent will work on it.', approveBacklog: 'It becomes an issue in Backlog: nobody works on it until you move it.',
    from: { system: 'Proposed by the daily suggestions.', note: 'From one of your notes, rewritten by the second brain: check it says what you meant.', other: 'From the second brain, out of material that may come from strangers (e.g. forwarded mail): read it carefully.' },
    branchTitle: 'Deploy this change?', branchGuard: 'It changes the protections (guard/): the deploy runner, the checks, the agent\'s permissions or rules.', branchGate: 'The merge gate is set to approve: every change waits for you.',
    branchAfter: 'After your tap the deploy runner merges it, applies it and runs the checks; if they fail it rolls back.',
    note: 'Note', issue: 'Issue', files: 'Files',
  },
  it: {
    login: 'Accedi', password: 'Password', enter: 'Entra', wrong: 'Password errata', throttled: 'Troppi tentativi, riprova tra 15 minuti',
    setup: 'Imposta la password', setupHelp: 'Link usa e getta. Genera la password con il gestore di password e salvala lì, poi incollala qui due volte.',
    newPw: 'Nuova password (almeno 12 caratteri)', repeat: 'Ripeti la password', save: 'Salva ed entra', mismatch: 'Le due password non coincidono',
    short: 'La password deve avere da 12 a 200 caratteri', badLink: 'Link non valido, scaduto o già usato',
    confirm: 'Conferma', cancel: 'Torna al tracker', done: 'Fatto', expired: 'Questa conferma è scaduta o è già stata usata. Torna indietro e riprova.',
    approveTitle: 'Approvare questa proposta?', approveTodo: 'Diventa una issue in Da fare: l\'agente ci lavorerà.', approveBacklog: 'Diventa una issue in Backlog: nessuno ci lavora finché non la sposti.',
    from: { system: 'Proposta dal giro giornaliero.', note: 'Da una tua nota, riscritta dal second brain: controlla che dica quello che volevi.', other: 'Dal second brain, da materiale che può venire da estranei (es. mail inoltrate): leggila con attenzione.' },
    branchTitle: 'Applicare questa modifica?', branchGuard: 'Cambia le protezioni (guard/): il deploy, i controlli, i permessi o le regole dell\'agente.', branchGate: 'Il merge gate è su approve: ogni modifica aspetta te.',
    branchAfter: 'Dopo il tuo tocco il deploy la unisce, la applica e fa i controlli; se falliscono torna indietro.',
    note: 'Nota', issue: 'Issue', files: 'File',
  },
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const PAGE_CSP = "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' " + ORIGINS.concat(CORIGINS).join(' ') + "; frame-ancestors 'none'; base-uri 'none'";
function page(res, code, lang, title, body, headers = {}) {
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="referrer" content="same-origin"><title>${esc(title)}</title><link rel="stylesheet" href="/confirm.css"><link rel="icon" href="/icon.svg"></head>` +
    `<body><main class="box"><img src="/icon.svg" alt="" width="40" height="40"><h1>${esc(title)}</h1>${body}</main></body></html>`;
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': PAGE_CSP,
    // same-origin, not no-referrer: with no-referrer browsers send `Origin: null` on form posts.
    'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers });
  res.end(html);
}
function redirect(res, to, headers = {}) { res.writeHead(303, { Location: to, 'Cache-Control': 'no-store', ...headers }); res.end(); }
// Where to go after login: only our own origins (no open redirect).
function safeNext(n) {
  if (typeof n !== 'string' || n.length > 500) return ORIGINS[0] + '/';
  try {
    const u = new URL(n, CORIGINS[0]);
    if (ORIGINS.concat(CORIGINS).includes(u.origin)) return u.href;
  } catch {}
  return ORIGINS[0] + '/';
}
async function readForm(req) {
  if (!/^application\/x-www-form-urlencoded\b/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'form only');
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 10000) throw new HttpError(413, 'too large'); chunks.push(c); }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
}

async function handleConfirm(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const lang = await uiLang();
  const t = T[lang] || T.en;
  if (p === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
  if (!CHOSTS.includes(req.headers.host)) return send(res, 421, { error: 'unknown host' });
  if (req.method === 'POST' && !CORIGINS.includes(req.headers.origin)) return send(res, 403, { error: 'bad origin' });
  if (req.method === 'GET' && (p === '/confirm.css' || p === '/icon.svg')) {
    const f = p === '/confirm.css' ? path.join(__dirname, 'confirm.css') : path.join(PUBLIC, 'icon.svg');
    try { return send(res, 200, await fsp.readFile(f), { 'Content-Type': p.endsWith('.css') ? 'text/css; charset=utf-8' : 'image/svg+xml', 'Cache-Control': 'no-cache' }); }
    catch { return send(res, 404, { error: 'not found' }); }
  }
  if (p === '/login') {
    const next = safeNext(url.searchParams.get('next'));
    const form = err => page(res, err ? 401 : 200, lang, t.login,
      `<form method="post" action="/login"><input type="hidden" name="next" value="${esc(next)}">` +
      `<input name="password" type="password" autocomplete="current-password" placeholder="${esc(t.password)}" required autofocus>` +
      `<button type="submit">${esc(t.enter)}</button>${err ? `<p class="err">${esc(err)}</p>` : ''}</form>`);
    if (req.method === 'GET') return form('');
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    const b = await readForm(req);
    if (throttled()) return form(t.throttled);
    if (typeof b.password !== 'string' || b.password.length > 200 || !checkPassword(b.password)) {
      failures.push(Date.now());
      await new Promise(r => setTimeout(r, 1000));
      return form(t.wrong);
    }
    failures = [];
    return redirect(res, safeNext(b.next), { 'Set-Cookie': sessionCookie() });
  }
  if (p === '/setup') {
    const token = url.searchParams.get('token') || '';
    const form = err => page(res, err ? 400 : 200, lang, t.setup,
      `<p class="muted">${esc(t.setupHelp)}</p><form method="post" action="/setup"><input type="hidden" name="token" value="${esc(token)}">` +
      `<input name="password" type="password" autocomplete="new-password" placeholder="${esc(t.newPw)}" minlength="12" required autofocus>` +
      `<input name="password2" type="password" autocomplete="new-password" placeholder="${esc(t.repeat)}" minlength="12" required>` +
      `<button type="submit">${esc(t.save)}</button>${err ? `<p class="err">${esc(err)}</p>` : ''}</form>`);
    if (req.method === 'GET') return checkSetupToken(token) ? form('') : page(res, 400, lang, t.setup, `<p class="err">${esc(t.badLink)}</p>`);
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    const b = await readForm(req);
    if (throttled()) return form(t.throttled);
    if (!checkSetupToken(b.token)) { failures.push(Date.now()); await new Promise(r => setTimeout(r, 1000)); return page(res, 401, lang, t.setup, `<p class="err">${esc(t.badLink)}</p>`); }
    if (b.password !== b.password2) return form(t.mismatch);
    if (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 200) return form(t.short);
    fs.writeFileSync(path.join(STATE, 'password.new'), hashPassword(b.password) + '\n', { mode: 0o600 });
    fs.renameSync(path.join(STATE, 'password.new'), path.join(STATE, 'password'));
    fs.unlinkSync(SETUP_FILE);
    // New password: every other session is dropped, this browser gets a fresh one.
    sessions = {};
    failures = [];
    return redirect(res, ORIGINS[0] + '/', { 'Set-Cookie': sessionCookie() });
  }
  const m = /^\/confirm\/([A-Za-z0-9_-]{24})$/.exec(p);
  if (m) {
    if (!authed(req)) return redirect(res, `/login?next=${encodeURIComponent(CORIGINS[0] + p)}`);
    const c = pending.get(m[1]);
    if (!c || c.exp < Date.now()) { pending.delete(m[1]); return page(res, 410, lang, t.confirm, `<p class="err">${esc(t.expired)}</p><p><a href="${esc(ORIGINS[0])}/">${esc(t.cancel)}</a></p>`); }
    if (req.method === 'GET') {
      return page(res, 200, lang, c.summary.title(t), c.summary.body(t) +
        `<form method="post" action="${esc(p)}"><input type="hidden" name="nonce" value="${esc(c.nonce)}">` +
        `<button type="submit" class="primary">${esc(t.confirm)}</button></form><p><a href="${esc(c.back)}">${esc(t.cancel)}</a></p>`);
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    const b = await readForm(req);
    if (typeof b.nonce !== 'string' || b.nonce.length !== c.nonce.length || !crypto.timingSafeEqual(Buffer.from(b.nonce), Buffer.from(c.nonce)))
      return page(res, 403, lang, t.confirm, `<p class="err">${esc(t.expired)}</p>`);
    pending.delete(m[1]);
    let back = c.back;
    if (c.action === 'approve-proposal') {
      const i = await approveProposal(c.args.id, c.args.status, c.args.note);
      back = `${ORIGINS[0]}/#${i.id}`;
    } else if (c.action === 'approve-branch') {
      await waitingBranch(c.args.branch, c.args.sha);
      await deployRequest('approve', c.args.branch, c.args.sha, '');
    }
    return redirect(res, back);
  }
  return send(res, 404, { error: 'not found' });
}

async function startConfirm(b) {
  if (!b || typeof b !== 'object') throw bad('invalid body');
  if (b.action === 'approve-proposal') {
    const id = typeof b.id === 'string' && /^\d{3,}$/.test(b.id) ? b.id : null;
    const cur = id && await find(id);
    if (!cur || cur.rawState !== 'proposed') throw new HttpError(409, 'not a pending proposal');
    const status = oneOf(b.status ?? 'todo', ['todo', 'backlog'], 'status');
    const note = b.note === undefined ? '' : oneLineOrEmpty(b.note, 1000, 'note');
    const i = cur.issue;
    const p = parse(cur.text);
    const summary = {
      title: t => t.approveTitle,
      body: t => `<p class="lead">#${esc(i.id)} ${esc(i.title)}</p><p class="warn">${esc(t.from[i.entry] || t.from.other)}</p>` +
        `<p>${esc(status === 'todo' ? t.approveTodo : t.approveBacklog)}</p>${note ? `<p><b>${esc(t.note)}:</b> ${esc(note)}</p>` : ''}` +
        `<pre class="desc">${esc(p.desc.slice(0, 4000))}</pre>`,
    };
    return { url: newConfirm('approve-proposal', { id, status, note }, summary, `${ORIGINS[0]}/#${id}`) };
  }
  if (b.action === 'approve-branch') {
    const s = await waitingBranch(b.branch, b.sha);
    const diff = await deployDiff(s.branch);
    const stat = diff.split('\n').filter(l => /\|/.test(l) || /files? changed/.test(l)).slice(0, 40).join('\n');
    const summary = {
      title: t => t.branchTitle,
      body: t => `<p class="lead"><code>${esc(s.branch)}</code>${s.issue ? ` · ${esc(t.issue)} #${esc(s.issue)}` : ''}</p>` +
        `<p class="warn">${esc(s.state === 'waiting-guard' ? t.branchGuard : t.branchGate)}</p><p>${esc(t.branchAfter)}</p>` +
        `<p><b>${esc(t.files)}</b></p><pre class="desc">${esc(stat)}</pre>`,
    };
    return { url: newConfirm('approve-branch', { branch: s.branch, sha: s.sha }, summary, `${ORIGINS[0]}/changes.html`) };
  }
  throw bad('invalid action');
}

// ---------- HTTP (main origin) ----------

const SEC_HEADERS = {
  'Content-Security-Policy': `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };

function send(res, code, body, headers = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(code, { ...SEC_HEADERS, 'Cache-Control': 'no-store', ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers });
  res.end(json ? JSON.stringify(body) : body);
}
async function readJson(req) {
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'json only');
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 300000) throw new HttpError(413, 'too large'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw bad('bad json'); }
}
async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  if (!/^[a-z0-9-]+\.[a-z]+$/.test(rel)) return send(res, 404, { error: 'not found' });
  try {
    const data = await fsp.readFile(path.join(PUBLIC, rel));
    send(res, 200, data, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch { send(res, 404, { error: 'not found' }); }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/healthz') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
  // Only via the configured names: no DNS rebinding.
  if (!HOSTS.includes(req.headers.host)) return send(res, 421, { error: 'unknown host' });
  // Proposers are scripts with a bearer token, not browsers: no cookie, so no CSRF to stop.
  if (p === '/api/propose' && req.method === 'POST') {
    const source = proposer(req);
    if (!source) { await new Promise(r => setTimeout(r, 1000)); return send(res, 401, { error: 'token' }); }
    const i = await proposeIssue(await readJson(req), source);
    return send(res, 201, { id: i.id, file: i.file });
  }
  if (p === '/api/proposals/index' && req.method === 'GET') {
    if (proposer(req) !== 'system') { await new Promise(r => setTimeout(r, 1000)); return send(res, 401, { error: 'token' }); }
    return send(res, 200, { proposals: await proposalIndex() });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Browsers always send Origin on these requests; anything else is cross-site or not ours.
    if (!ORIGINS.includes(req.headers.origin)) return send(res, 403, { error: 'bad origin' });
  }
  if (p === '/api/whoami') return send(res, 200, { login: `${CORIGINS[0]}/login`, authed: authed(req), lang: await uiLang() });
  if (!p.startsWith('/api/')) return req.method === 'GET' ? serveStatic(res, p) : send(res, 405, { error: 'method' });
  if (!authed(req)) return send(res, 401, { error: 'login', login: `${CORIGINS[0]}/login` });
  if (p === '/api/logout' && req.method === 'POST') {
    delete sessions[sha(cookieToken(req))]; saveSessions();
    return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly;${SECURE ? ' Secure;' : ''} SameSite=Strict; Max-Age=0` });
  }
  if (p === '/api/issues' && req.method === 'GET') return send(res, 200, { issues: await listIssues(), author: AUTHOR, staleAfter: await staleAfter(), lang: await uiLang(), waiting: (await deployStates()).filter(s => /^waiting-/.test(s.state)).length });
  if (p === '/api/issues' && req.method === 'POST') return send(res, 201, await createIssue(await readJson(req)));
  const m = /^\/api\/issues\/(\d{3,})$/.exec(p);
  if (m && req.method === 'GET') {
    const cur = await find(m[1]);
    if (!cur) return send(res, 404, { error: 'not found' });
    const parsed = parse(cur.text);
    const all = await listIssues();
    const me = all.find(i => i.id === cur.issue.id && i.state === cur.issue.state) || cur.issue;
    const brief = ({ id, title, column, state }) => ({ id, title, column, state });
    const children = all.filter(i => i.parent === me.id).sort((a, b) => a.id.localeCompare(b.id)).map(brief);
    const rel = ids => ids.map(x => all.find(i => i.id === x)).filter(Boolean).map(brief);
    const links = { related: rel(me.relatedAll || []), blocks: rel(me.blocks || []), blockedBy: rel(blockers(me.blockedOn) || []),
      duplicates: rel(me.duplicates || []), duplicateOf: rel(me.duplicateOf ? [me.duplicateOf] : []),
      possibleDuplicate: rel(me.state === 'proposed' && me.possibleDuplicate ? [me.possibleDuplicate] : []) };
    let problems = [];
    if (me.state === 'open') try { problems = lint(REPO).filter(x => (x.ids || [x.id]).includes(me.id)).map(x => x.msg); } catch {}
    // Link to the origin note in Obsidian: the tracker never reads the vault, it only builds the URL
    // from the validated path and the vault name of the settings page.
    let originUrl = '';
    if (me.originPath) {
      const vault = (await readSettings()).APPETITO_OBSIDIAN_VAULT ?? SCHEMA.APPETITO_OBSIDIAN_VAULT.default;
      originUrl = `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(me.originPath)}`;
    }
    const branches = (await deployStates()).filter(s => s.issue === me.id).slice(0, 5);
    return send(res, 200, { ...me, originUrl, children, links, problems, desc: parsed.desc, commentList: parsed.comments, history: await history(cur.issue.file, cur.rawState), branches });
  }
  if (m && req.method === 'PATCH') return send(res, 200, await updateIssue(m[1], await readJson(req)));
  if (p === '/api/confirm' && req.method === 'POST') return send(res, 200, await startConfirm(await readJson(req)));
  if (p === '/api/auto' && req.method === 'GET') return send(res, 200, await autoStatus());
  if (p === '/api/auto/run' && req.method === 'POST') return send(res, 202, await autoRun(await readJson(req)));
  if (p === '/api/deploy' && req.method === 'GET') {
    const states = await deployStates();
    const waiting = await Promise.all(states.filter(s => /^waiting-/.test(s.state)).map(async s => ({ ...s, diff: (await deployDiff(s.branch)).slice(0, 150000) })));
    return send(res, 200, { gate: GATE, waiting, recent: states.slice(0, 20), lang: await uiLang() });
  }
  if (p === '/api/deploy/reject' && req.method === 'POST') {
    const b = await readJson(req);
    await waitingBranch(b.branch, b.sha);
    await deployRequest('reject', b.branch, b.sha, b.note === undefined ? '' : oneLineOrEmpty(b.note, 500, 'note'));
    return send(res, 202, { ok: true });
  }
  if (p === '/api/settings' && req.method === 'GET') return send(res, 200, await getSettings());
  if (p === '/api/settings' && req.method === 'PUT') return send(res, 200, await saveSettings(await readJson(req)));
  send(res, 404, { error: 'not found' });
}

const onError = res => e => {
  if (!(e instanceof HttpError)) console.error(e);
  if (!res.headersSent) send(res, e instanceof HttpError ? e.code : 500, { error: e instanceof HttpError ? e.message : 'internal error' });
};
const HOST = process.env.TRACKER_LISTEN || '127.0.0.1';
http.createServer((req, res) => { handle(req, res).catch(onError(res)); })
  .listen(PORT, HOST, () => console.log(`tracker on ${HOST}:${PORT}, repo ${REPO}`));
http.createServer((req, res) => { handleConfirm(req, res).catch(onError(res)); })
  .listen(CPORT, HOST, () => console.log(`tracker confirm pages on ${HOST}:${CPORT}`));
