'use strict';
// home-server issue tracker: a Linear-style board over the repo's issues/{open,done}/*.md.
// The markdown files stay the source of truth (Claude edits them too); this service only
// reads/writes them (atomic temp+rename) and reads git history. Commits are made by
// $HS_USER's cron (issues-autocommit). No npm dependencies on purpose.
//
// Env: TRACKER_REPO (repo path, required), TRACKER_STATE (/var/lib/tracker: password hash,
// sessions), TRACKER_PORT (3004), TRACKER_ORIGINS (comma-separated https origins allowed to
// write, e.g. https://server.tailXXXX.ts.net:8444), TRACKER_AUTHOR (name on comments),
// TRACKER_SETTINGS (/var/lib/hs-settings/settings.env, written by /settings.html).
//
// Proposals: two proposers may POST /api/propose with a bearer token: the second brain (user brain,
// reads untrusted material; sha256 in $TRACKER_STATE/propose-token, written by brain-setup) and the
// system (ops-suggest, issue 028; sha256 in $TRACKER_STATE/suggest-token, written by tracker-setup).
// Which token authenticated decides `Source: brain|system`, never the request body. Proposals
// land in issues/proposed/, which the ops session and the implementation job never read as work;
// the owner approves one by moving it to a board column (the file moves to issues/open/).
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const REPO = process.env.TRACKER_REPO;
if (!REPO) { console.error('TRACKER_REPO not set'); process.exit(1); }
const STATE = process.env.TRACKER_STATE || '/var/lib/tracker';
const PORT = Number(process.env.TRACKER_PORT || 3004);
const ORIGINS = (process.env.TRACKER_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const HOSTS = ORIGINS.map(o => new URL(o).host);
const AUTHOR = process.env.TRACKER_AUTHOR || 'web';
const PUBLIC = path.join(__dirname, 'public');
const DIRS = { open: path.join(REPO, 'issues', 'open'), done: path.join(REPO, 'issues', 'done'), proposed: path.join(REPO, 'issues', 'proposed') };

const STATUSES = ['backlog', 'todo', 'in-progress'];
const COLUMNS = [...STATUSES, 'blocked', 'done'];
const PROPOSALS_PER_DAY = { brain: 20, system: 10 };
const PROPOSER_TOKENS = { brain: 'propose-token', system: 'suggest-token' };
// Scarta reasons (chips in the drawer): `Reject-reason:` header + a comment.
const REJECT_REASONS = ['non mi interessa', 'non ora', 'troppo complessa', 'già coperta', 'sbagliata'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'];
const SESSION_DAYS = 90;
const COOKIE = 'hs_tracker';

// ---------- issue files ----------

const { parse, serialize, getField, setField, now, FILE_RE, COMMENTS_RE, housekeep, lint, blockers, idList, similar, corpus, backlogAge, parseGitDates, GIT_DATES_ARGS } = require('./issues');

// Who proposed it: `Source:` (set by the tracker from the token); proposals older than the field
// (label "proposed", no Source) all came from the second brain. '' = not a proposal.
function sourceOf(p) {
  const s = (getField(p, 'Source') || '').trim();
  if (s === 'system' || s === 'brain') return s;
  return /(^|,)\s*proposed\s*(,|$)/.test(getField(p, 'Labels') || '') ? 'brain' : '';
}

// Entry point of a proposal (issue 048), from `Source:` + `Origin:` only, never the body:
// 'system' (ops-suggest), 'note' (the owner's inbox note archived by brain: Archive/Inbox/…),
// 'mail' (the mail pipeline, `Origin: mail:<archived path>`, and any other brain origin, the cautious
// wording). originPath: the vault path behind it, only if it is a plain relative path under Archive/.
function originPathOf(origin) {
  const o = origin.trim().replace(/^mail:/, '');
  if (o.length > 300 || !/^Archive\//.test(o) || /[\x00-\x1f\x7f\\:]/.test(o)) return '';
  return o.split('/').some(seg => seg === '' || seg === '.' || seg === '..') ? '' : o;
}
function entryOf(source, origin) {
  if (source === 'system') return 'system';
  if (source !== 'brain') return '';
  return !/^\s*mail:/.test(origin) && /^Archive\/Inbox\//.test(originPathOf(origin)) ? 'note' : 'mail';
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
  return {
    id: num, slug, file, state, title: p.title || slug,
    column: state === 'done' ? 'done' : state === 'proposed' ? 'proposed' : blocked ? 'blocked' : status,
    status, blockedOn: blocked,
    priority: PRIORITIES.includes(prioRaw) ? prioRaw : 'none',
    labels: labelList,
    // Same rule as ops-auto's selector: what "Lavora su questa issue" (issue 067) may start.
    pickable: state === 'open' && !blocked && !labelList.includes('epic') && (labelList.includes('monitor') || ['todo', 'in-progress'].includes(statusRaw)),
    parent: /^\d{3,}$/.test(parentRaw) ? parentRaw : '',
    opened: getField(p, 'Opened') || '', closed: getField(p, 'Closed') || '', origin,
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
  for (const state of ['open', 'done', 'proposed']) {
    let names = [];
    try { names = await fsp.readdir(DIRS[state]); } catch { continue; }
    for (const file of names) if (FILE_RE.test(file)) out.push({ state, file });
  }
  return out;
}

async function load(state, file) {
  const full = path.join(DIRS[state], file);
  const [text, st] = await Promise.all([fsp.readFile(full, 'utf8'), fsp.stat(full)]);
  return { text, full, issue: model(state, file, text, st.mtime.toISOString()) };
}

async function listIssues() {
  const all = await Promise.all((await listFiles()).map(f => load(f.state, f.file).then(x => x.issue).catch(() => null)));
  return withStale(withFamily(all.filter(Boolean).sort((a, b) => b.id.localeCompare(a.id))), await backlogDates(), await staleAfter());
}

// Stale backlog (issue 063): `stale` = days without a decision on a Backlog issue, 0 if under the threshold
// (setting HS_BACKLOG_STALE_DAYS) or not in Backlog. The last-commit dates come from one `git log` per minute.
let gitDatesCache = { at: 0, dates: new Map() };
async function backlogDates() {
  if (Date.now() - gitDatesCache.at > 60e3) {
    const out = await git(GIT_DATES_ARGS);
    gitDatesCache = { at: Date.now(), dates: out === null ? gitDatesCache.dates : parseGitDates(out) };
  }
  return gitDatesCache.dates;
}
async function staleAfter() { return (await readSettings()).HS_BACKLOG_STALE_DAYS ?? SCHEMA.HS_BACKLOG_STALE_DAYS.default; }
function withStale(issues, dates, days) {
  for (const i of issues) {
    const age = i.column === 'backlog' ? backlogAge(i.backlogReviewed, i.opened, dates.get(i.file)) : null;
    i.stale = age !== null && age >= days ? age : 0;
  }
  return issues;
}

// Sub-issues: only the child stores the relation (`Parent: NNN`); a parent's children are derived.
// Same for the other relations (issue 058): `Related:` is shown on both sides (relatedAll), the
// blocker of `Blocked on: issue NNN` gets `blocks`, the kept issue of `Duplicate of:` gets `duplicates`.
function withFamily(issues) {
  const byId = new Map(issues.map(i => [i.id, i]));
  for (const i of issues) { i.children = { done: 0, total: 0 }; i.parentTitle = ''; i.relatedAll = new Set(i.related); i.blocks = []; i.duplicates = []; }
  for (const i of issues) {
    for (const r of i.related) byId.get(r)?.relatedAll.add(i.id);
    for (const b of blockers(i.blockedOn) || []) byId.get(b)?.blocks.push(i.id);
    if (i.duplicateOf) byId.get(i.duplicateOf)?.duplicates.push(i.id);
  }
  for (const i of issues) i.relatedAll = [...i.relatedAll].filter(r => r !== i.id && byId.has(r)).sort();
  for (const i of issues) {
    const par = i.parent && byId.get(i.parent);
    if (!par) continue;
    i.parentTitle = par.title;
    par.children.total++;
    if (i.state === 'done') par.children.done++;
  }
  return issues;
}

// One level only: a parent must exist, not be the issue itself and not be a child; an issue with
// children can't get a parent. Throws on a bad link, returns the normalised id ('' = none).
function checkParent(all, id, parent) {
  if (parent === '' || parent === null) return '';
  if (typeof parent !== 'string' || !/^\d{3,}$/.test(parent)) throw bad('invalid parent');
  const par = all.find(i => i.id === parent);
  if (!par) throw bad(`la issue #${parent} non esiste`);
  if (parent === id) throw bad('una issue non può essere padre di se stessa');
  if (par.parent) throw bad(`#${parent} è già una sotto-issue (un solo livello)`);
  if (id && all.some(i => i.parent === id)) throw bad(`#${id} ha già sotto-issue (un solo livello)`);
  return parent;
}

async function find(id) {
  if (!/^\d{3,}$/.test(id)) return null;
  const f = (await listFiles()).find(x => x.file.startsWith(id + '-'));
  return f ? load(f.state, f.file) : null;
}

// Atomic write: the tracker may only create/rename entries in the issue dirs (files written
// by others are read-only to it), so never write in place.
async function writeAtomic(full, text) {
  const tmp = path.join(path.dirname(full), `.tracker-tmp-${crypto.randomBytes(6).toString('hex')}`);
  await fsp.writeFile(tmp, text, { mode: 0o664 });
  try { await fsp.rename(tmp, full); } catch (e) { await fsp.unlink(tmp).catch(() => {}); throw e; }
}

// One writer at a time, so read-check-write sequences don't interleave.
let queue = Promise.resolve();
const serial = fn => { const r = queue.then(fn); queue = r.catch(() => {}); return r; };

// ---------- git (read-only) ----------

function git(args) {
  return new Promise(resolve => execFile('git', ['-C', REPO, '-c', `safe.directory=${REPO}`, ...args],
    { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 10000, maxBuffer: 4 << 20 },
    (err, out) => resolve(err ? null : out)));
}

async function history(file) {
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
// Optional single line: '' allowed (no note), newlines folded into spaces.
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
const oneOf = (v, list, name) => { if (!list.includes(v)) throw bad(`invalid ${name}`); return v; };
// A body must not smuggle in a section the parser would read as comments.
const noComments = s => { if (s.split('\n').some(l => COMMENTS_RE.test(l))) throw bad('"## Comments" is reserved'); return s; };

function slugify(title) {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'issue';
}

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
  return serial(async () => {
    const nums = (await listFiles()).map(f => parseInt(f.file, 10));
    const id = String(Math.max(0, ...nums) + 1).padStart(3, '0');
    if (b.parent !== undefined) { const par = checkParent(await listIssues(), id, b.parent); if (par) setField(p, 'Parent', par); }
    const file = `${id}-${slugify(title)}.md`;
    await writeAtomic(path.join(DIRS.open, file), serialize(p));
    return (await load('open', file)).issue;
  });
}

// A proposal: always backlog, label "proposed", `Source:` = the proposer whose token authenticated.
// Second brain: Origin: required (the archived inbox item it came from); Parent only another proposal
// (an epic it proposed too). System (ops-suggest): Origin is `ops-suggest <date>`, labels must carry
// afk or hitl, no Parent (a big idea is one issue labelled epic). Separate daily limits.
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
  setField(p, 'Origin', source === 'system' ? `ops-suggest ${day}` : oneLine(b.origin, 300, 'origin'));
  return serial(async () => {
    const nums = (await listFiles()).map(f => parseInt(f.file, 10));
    const id = String(Math.max(0, ...nums) + 1).padStart(3, '0');
    if (source === 'brain' && b.parent !== undefined && b.parent !== '') {
      const all = await listIssues();
      const par = checkParent(all, id, b.parent);
      if (all.find(i => i.id === par).state !== 'proposed') throw bad('parent must be a proposal');
      setField(p, 'Parent', par);
    }
    // Deterministic duplicate check (issue 058): the closest open/proposed/recent done issue, shown
    // next to Approva/Scarta. Only the id is stored.
    try { const c = similar(corpus(REPO, true), title, p.desc)[0]; if (c) setField(p, 'Possible-duplicate', c.id); } catch (e) { console.error('similar: ' + e.message); }
    await fsp.mkdir(DIRS.proposed, { recursive: true });
    const file = `${id}-${slugify(title)}.md`;
    await writeAtomic(path.join(DIRS.proposed, file), serialize(p));
    proposals[source]++;
    return (await load('proposed', file)).issue;
  });
}

// `related`: the full list of issues related to this one (both sides). Kept on this issue's
// `Related:` field; an id removed here is also dropped from the other issue's field (written too).
function relatedIds(v, id, all) {
  if (!Array.isArray(v) || v.length > 20) throw bad('invalid related');
  const out = [...new Set(v)];
  for (const r of out) {
    if (typeof r !== 'string' || !/^\d{3,}$/.test(r)) throw bad('invalid related');
    if (r === id) throw bad('una issue non può essere correlata a se stessa');
    if (!all.some(i => i.id === r)) throw bad(`la issue #${r} non esiste`);
  }
  return out.sort();
}

async function updateIssue(id, b) {
  return serial(async () => {
    const cur = await find(id);
    if (!cur) throw new HttpError(404, 'not found');
    if (b.version !== cur.issue.version) throw new HttpError(409, 'changed meanwhile');
    const p = parse(cur.text);
    let state = cur.issue.state;
    if (b.title !== undefined) p.title = oneLine(b.title, 200, 'title');
    if (b.desc !== undefined) p.desc = noComments(text(b.desc, 200000, 'description')).trim();
    if (b.priority !== undefined) setField(p, 'Priority', oneOf(b.priority, PRIORITIES, 'priority') === 'none' ? null : b.priority);
    if (b.labels !== undefined) { const l = labels(b.labels); setField(p, 'Labels', l.length ? l.join(', ') : null); }
    // Approva / Approva in backlog / Scarta on a proposal, with an optional note or reason (issue 027).
    const notes = [];
    // Segna come duplicato di… / Scarta come duplicato (issue 058): closed into done/ with `Duplicate of:`,
    // label "duplicato" (a proposal: also scartata, reason "già coperta").
    if (b.duplicateOf !== undefined) {
      if (b.approve !== undefined || b.reject !== undefined || b.column !== undefined) throw bad('duplicateOf sets the column');
      if (cur.issue.state === 'done') throw bad('già chiusa');
      const dup = b.duplicateOf;
      if (typeof dup !== 'string' || !/^\d{3,}$/.test(dup)) throw bad('invalid duplicateOf');
      if (dup === id) throw bad('una issue non può essere duplicato di se stessa');
      const target = (await listIssues()).find(i => i.id === dup);
      if (!target) throw bad(`la issue #${dup} non esiste`);
      if (target.duplicateOf === id) throw bad(`#${dup} è già duplicato di #${id}`);
      const note = b.note === undefined ? '' : oneLineOrEmpty(b.note, 1000, 'note');
      const extra = cur.issue.state === 'proposed' ? ['scartata', 'duplicato'] : ['duplicato'];
      const lab = (getField(p, 'Labels') || '').split(',').map(x => x.trim()).filter(Boolean);
      setField(p, 'Labels', [...new Set([...lab, ...extra])].join(', '));
      setField(p, 'Duplicate of', dup);
      if (cur.issue.state === 'proposed') { setField(p, 'Reject-reason', 'già coperta'); notes.push([`Scartata: già coperta — duplicato di #${dup}`, note].filter(Boolean).join(' — ')); }
      else notes.push([`Duplicato di #${dup}: chiusa qui, si continua lì.`, note].filter(Boolean).join(' — '));
      b.column = 'done';
    }
    const others = []; // other issues to rewrite (Related removed on their side)
    if (b.related !== undefined) {
      const all = await listIssues();
      const want = relatedIds(b.related, id, all);
      for (const o of all.filter(i => i.related.includes(id) && !want.includes(i.id))) others.push(o.id);
      // Stored here unless the other side already names this issue.
      const mine = want.filter(r => !all.find(i => i.id === r).related.includes(id) || cur.issue.related.includes(r));
      setField(p, 'Related', mine.length ? mine.join(', ') : null);
    }
    if (b.approve !== undefined || b.reject !== undefined) {
      if (cur.issue.state !== 'proposed') throw bad('non è una proposta');
      if (b.approve !== undefined && b.reject !== undefined) throw bad('approve or reject');
      if (b.column !== undefined) throw bad('approve/reject set the column');
      const d = b.approve ?? b.reject;
      if (typeof d !== 'object' || d === null || Array.isArray(d)) throw bad('invalid decision');
      const note = d.note === undefined ? '' : oneLineOrEmpty(d.note, 1000, 'note');
      if (b.approve !== undefined) {
        b.column = oneOf(d.status ?? 'todo', ['todo', 'backlog'], 'status');
        if (note) notes.push(`Approvata: ${note}`);
      } else {
        const reason = d.reason === undefined || d.reason === '' ? '' : oneOf(d.reason, REJECT_REASONS, 'reason');
        b.column = 'done';
        const lab = (getField(p, 'Labels') || '').split(',').map(s => s.trim()).filter(Boolean);
        if (!lab.includes('scartata')) setField(p, 'Labels', [...lab, 'scartata'].join(', '));
        if (reason) setField(p, 'Reject-reason', reason);
        if (reason || note) notes.push(['Scartata' + (reason ? `: ${reason}` : ''), note].filter(Boolean).join(' — '));
      }
    }
    // Stale backlog (issue 063): Sposta in To do / Tieni in backlog (`Backlog-reviewed:`, the clock restarts) /
    // Scarta (done/, label scartata, same reasons as proposals). Backlog issues only.
    if (b.backlog !== undefined) {
      if (b.approve !== undefined || b.reject !== undefined || b.column !== undefined || b.duplicateOf !== undefined) throw bad('backlog sets the column');
      if (cur.issue.column !== 'backlog') throw bad('non è in Backlog');
      const d = b.backlog;
      if (typeof d !== 'object' || d === null || Array.isArray(d)) throw bad('invalid decision');
      const note = d.note === undefined ? '' : oneLineOrEmpty(d.note, 1000, 'note');
      const action = oneOf(d.action, ['todo', 'keep', 'reject'], 'action');
      if (action === 'todo') {
        b.column = 'todo';
        if (note) notes.push(`Spostata in To do: ${note}`);
      } else if (action === 'keep') {
        setField(p, 'Backlog-reviewed', now().date);
        if (note) notes.push(`Tenuta in backlog: ${note}`);
      } else {
        const reason = d.reason === undefined || d.reason === '' ? '' : oneOf(d.reason, REJECT_REASONS, 'reason');
        b.column = 'done';
        const lab = (getField(p, 'Labels') || '').split(',').map(x => x.trim()).filter(Boolean);
        if (!lab.includes('scartata')) setField(p, 'Labels', [...lab, 'scartata'].join(', '));
        if (reason) setField(p, 'Reject-reason', reason);
        if (reason || note) notes.push(['Scartata' + (reason ? `: ${reason}` : ''), note].filter(Boolean).join(' — '));
      }
    }
    if (b.parent !== undefined || b.column === 'done') {
      const all = await listIssues();
      if (b.parent !== undefined) setField(p, 'Parent', checkParent(all, id, b.parent) || null);
      const open = all.filter(i => i.parent === id && i.state !== 'done').length;
      if (b.column === 'done' && open) throw bad(open === 1 ? 'non si chiude: 1 sotto-issue aperta' : `non si chiude: ${open} sotto-issue aperte`);
    }
    if (b.column !== undefined) {
      const col = oneOf(b.column, COLUMNS, 'column');
      // A proposal leaves issues/proposed/ only by being approved (any open column) or rejected (done).
      if (col === 'done') {
        state = 'done';
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
    // Epic whose last child just closed -> closed; dependants of a closed issue -> unblocked (issue 033).
    try { for (const l of housekeep(REPO)) console.log('housekeep: ' + l); } catch (e) { console.error('housekeep: ' + e.message); }
    return (await find(id)).issue;
  });
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
  const m = /(?:^|;\s*)hs_tracker=([A-Za-z0-9_-]{20,})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
// Which proposer the bearer token belongs to ('brain' | 'system'), or null.
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

// Hash format (written by tracker-passwd): scrypt$N$r$p$salt_b64$hash_b64
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

// Same format tracker-passwd writes.
function hashPassword(pw) {
  const s = crypto.randomBytes(16), N = 32768, r = 8, p = 1;
  const k = crypto.scryptSync(pw.normalize('NFC'), s, 32, { N, r, p, maxmem: 256 * N * r + (1 << 20) });
  return ['scrypt', N, r, p, s.toString('base64'), k.toString('base64')].join('$');
}

// One-time setup link (`tracker-passwd --link`): the owner picks the password in the browser, so a
// password manager on the phone can generate and store it, no terminal needed.
// File: "<sha256 of token> <expiry ms>", deleted once used.
const SETUP_FILE = path.join(STATE, 'setup-token');
function checkSetupToken(token) {
  let hash, exp;
  try { [hash, exp] = fs.readFileSync(SETUP_FILE, 'utf8').trim().split(' '); } catch { return false; }
  if (!/^[0-9a-f]{64}$/.test(hash || '') || !(+exp > Date.now()) || typeof token !== 'string' || token.length > 200) return false;
  return crypto.timingSafeEqual(Buffer.from(sha(token), 'hex'), Buffer.from(hash, 'hex'));
}

function newSession(res, body) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[sha(token)] = Date.now() + SESSION_DAYS * 86400e3;
  saveSessions();
  return send(res, 200, body, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}` });
}

// ---------- Phone apps ("Ho aggiornato" for the dashboard card) ----------
// phone-apps-check ($HS_USER's cron) writes the latest releases to PHONE_STATUS; the owner's
// marks (app id -> version installed on the phone) go to PHONE_MARKS, which that job reads.

const PHONE_STATUS = '/var/lib/edge-status/phone-apps.json';
const PHONE_MARKS = '/var/lib/phone-apps/installed.json';

async function phoneApps() {
  try { return { apps: JSON.parse(await fsp.readFile(PHONE_STATUS, 'utf8')).apps || {} }; } catch { return { apps: {} }; }
}

function markPhoneApp(id, b) { return serial(() => markPhoneAppNow(id, b)); }
async function markPhoneAppNow(id, b) {
  const app = (await phoneApps()).apps[id];
  if (!app) throw new HttpError(404, 'app sconosciuta');
  // Only the latest release seen by the check can be marked: no free text reaches the card.
  if (typeof b.version !== 'string' || b.version !== app.latest || !/^[A-Za-z0-9._-]{1,40}$/.test(b.version)) throw bad('versione non valida');
  let marks = {};
  try { marks = JSON.parse(await fsp.readFile(PHONE_MARKS, 'utf8')); } catch {}
  marks[id] = b.version;
  await writeAtomic(PHONE_MARKS, JSON.stringify(marks, null, 2) + '\n');
  return { ok: true, id, installed: b.version };
}

// ---------- Automatic maintenance status and manual start (/auto.html, issue 067) ----------
// ops-auto-card ($HS_USER) writes AUTO_STATUS; "Avvia ora" writes AUTO_REQUEST ({id, at, issue}),
// which $HS_USER's ops-auto-request (cron, every minute) answers by starting `ops-auto --manual`
// and echoing the id back in AUTO_STATUS.request. The tracker never runs anything itself.

const AUTO_STATUS = process.env.TRACKER_AUTO_STATUS || '/var/lib/edge-status/ops-auto.json';
const AUTO_REQUEST = process.env.TRACKER_AUTO_REQUEST || '/var/lib/ops-auto-req/request.json';
const AUTO_PER_HOUR = 6;
let autoStarts = [];

async function autoStatus() {
  let status = null, req = null;
  try { status = JSON.parse(await fsp.readFile(AUTO_STATUS, 'utf8')); } catch {}
  try { req = JSON.parse(await fsp.readFile(AUTO_REQUEST, 'utf8')); } catch {}
  // Pending: written here, not answered yet and not stale (the job refuses after 10 minutes).
  const pending = req && (!status || !status.request || status.request.id !== req.id) && Date.now() / 1000 - req.at < 660 ? req : null;
  return { status, pending, now: Math.floor(Date.now() / 1000) };
}

function autoRun(b) { return serial(() => autoRunNow(b)); }
async function autoRunNow(b) {
  let issue = null;
  if (b.issue != null && b.issue !== '') {
    if (typeof b.issue !== 'string' || !/^\d{3,4}$/.test(b.issue)) throw bad('issue non valida');
    const i = (await listIssues()).find(x => x.id === b.issue);
    if (!i) throw new HttpError(404, 'issue non trovata');
    if (!i.pickable) throw new HttpError(409, 'questa issue non è lavorabile dalla manutenzione automatica (aperta, Da fare o In corso, non bloccata, non epic)');
    issue = i.id;
  }
  const { status, pending } = await autoStatus();
  if (pending) throw new HttpError(409, 'c\'è già una richiesta in attesa');
  if (status && status.code === 'working') throw new HttpError(409, `già al lavoro su #${status.current && status.current.id}`);
  autoStarts = autoStarts.filter(t => t > Date.now() - 3600e3);
  if (autoStarts.length >= AUTO_PER_HOUR) throw new HttpError(429, `massimo ${AUTO_PER_HOUR} avvii manuali all'ora`);
  autoStarts.push(Date.now());
  const req = { id: crypto.randomBytes(8).toString('hex'), at: Math.floor(Date.now() / 1000), issue };
  await writeAtomic(AUTO_REQUEST, JSON.stringify(req) + '\n');
  return { ok: true, pending: req };
}

// ---------- Settings (/settings.html, issue 025) ----------
// Only the keys of settings.schema.json (repo, read-only here), each checked against its type and
// range; written as KEY=value lines to SETTINGS_FILE (tracker-owned, world-readable), which jobs read
// through hs-setting (missing or invalid = default). Nothing security-relevant is in the schema.

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.schema.json'), 'utf8'));
const SETTINGS_FILE = process.env.TRACKER_SETTINGS || '/var/lib/hs-settings/settings.env';
const known = k => Object.hasOwn(SCHEMA, k);
// 'text' settings: one short line, no quotes, slashes, '=' or control characters (hs-setting checks the same).
const TEXT_RE = /^[^\x00-\x1f\x7f"'\\/=]{1,64}$/;

// JSON value -> file value (throws 400), and back (null = absent or invalid).
function settingOut(key, v) {
  const s = known(key) && SCHEMA[key];
  if (!s) throw bad(`impostazione sconosciuta: ${key}`);
  const range = `${s.label}: valore non valido`;
  switch (s.type) {
    case 'bool': if (typeof v !== 'boolean') throw bad(range); return v ? '1' : '0';
    case 'int': if (!Number.isInteger(v) || v < s.min || v > s.max) throw bad(`${s.label}: da ${s.min} a ${s.max}`); return String(v);
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
  let text = '';
  try { text = await fsp.readFile(SETTINGS_FILE, 'utf8'); } catch {}
  const set = {};
  for (const l of text.split('\n')) {
    const m = /^([A-Z][A-Z0-9_]{0,40})=(.*)$/.exec(l);
    if (m && known(m[1])) { const v = settingIn(m[1], m[2]); if (v !== null) set[m[1]] = v; }
  }
  return set;
}

async function getSettings() {
  const set = await readSettings();
  return { schema: SCHEMA, values: Object.fromEntries(Object.keys(SCHEMA).map(k => [k, k in set ? set[k] : SCHEMA[k].default])), set: Object.keys(set) };
}

// Body {values: {KEY: value | null}}: null drops the key (back to the default). All or nothing.
function saveSettings(b) { return serial(() => saveSettingsNow(b)); }
async function saveSettingsNow(b) {
  if (!b || typeof b.values !== 'object' || b.values === null || Array.isArray(b.values)) throw bad('values mancante');
  const set = await readSettings();
  const lines = {};
  for (const [k, v] of Object.entries(set)) lines[k] = settingOut(k, v);
  for (const [k, v] of Object.entries(b.values)) {
    if (!known(k)) throw bad(`impostazione sconosciuta: ${k}`);
    if (v === null) delete lines[k]; else lines[k] = settingOut(k, v);
  }
  const out = '# Written by the tracker (/settings.html); read with hs-setting KEY. Missing key = default.\n' +
    Object.keys(SCHEMA).filter(k => k in lines).map(k => `${k}=${lines[k]}\n`).join('');
  await writeAtomic(SETTINGS_FILE, out);
  return getSettings();
}

// ---------- HTTP ----------

const SEC_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

function send(res, code, body, headers = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(code, { ...SEC_HEADERS, 'Cache-Control': 'no-store',
    ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers });
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
  // Only via the configured names (Caddy keeps the client's Host): no DNS rebinding.
  if (!HOSTS.includes(req.headers.host)) return send(res, 421, { error: 'unknown host' });
  // The proposer is a script with a bearer token, not a browser: no cookie, so no CSRF to stop.
  if (p === '/api/propose' && req.method === 'POST') {
    const source = proposer(req);
    if (!source) { await new Promise(r => setTimeout(r, 1000)); return send(res, 401, { error: 'token' }); }
    const i = await proposeIssue(await readJson(req), source);
    return send(res, 201, { id: i.id, file: i.file });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Browsers always send Origin on these requests; anything else is cross-site or not a browser of ours.
    if (!ORIGINS.includes(req.headers.origin)) return send(res, 403, { error: 'bad origin' });
  }
  if (!p.startsWith('/api/')) return req.method === 'GET' ? serveStatic(res, p) : send(res, 405, { error: 'method' });

  if (p === '/api/login' && req.method === 'POST') {
    if (throttled()) return send(res, 429, { error: 'troppi tentativi, riprova tra 15 minuti' });
    const b = await readJson(req);
    if (typeof b.password !== 'string' || b.password.length > 200 || !checkPassword(b.password)) {
      failures.push(Date.now());
      await new Promise(r => setTimeout(r, 1000));
      return send(res, 401, { error: 'password errata' });
    }
    failures = [];
    return newSession(res, { ok: true });
  }
  if (p === '/api/setup' && req.method === 'POST') {
    if (throttled()) return send(res, 429, { error: 'troppi tentativi, riprova tra 15 minuti' });
    const b = await readJson(req);
    if (!checkSetupToken(b.token)) {
      failures.push(Date.now());
      await new Promise(r => setTimeout(r, 1000));
      return send(res, 401, { error: 'link non valido, scaduto o già usato' });
    }
    if (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 200) throw bad('la password deve avere da 12 a 200 caratteri');
    fs.writeFileSync(path.join(STATE, 'password.new'), hashPassword(b.password) + '\n', { mode: 0o600 });
    fs.renameSync(path.join(STATE, 'password.new'), path.join(STATE, 'password'));
    fs.unlinkSync(SETUP_FILE);
    // New password: every other session is dropped, this browser gets a fresh one.
    sessions = {};
    failures = [];
    return newSession(res, { ok: true });
  }
  if (!authed(req)) return send(res, 401, { error: 'login' });
  if (p === '/api/logout' && req.method === 'POST') {
    delete sessions[sha(cookieToken(req))]; saveSessions();
    return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }
  if (p === '/api/issues' && req.method === 'GET') return send(res, 200, { issues: await listIssues(), author: AUTHOR, staleAfter: await staleAfter() });
  if (p === '/api/issues' && req.method === 'POST') return send(res, 201, await createIssue(await readJson(req)));
  const m = /^\/api\/issues\/(\d{3,})$/.exec(p);
  if (m && req.method === 'GET') {
    const cur = await find(m[1]);
    if (!cur) return send(res, 404, { error: 'not found' });
    const parsed = parse(cur.text);
    const all = await listIssues();
    const me = all.find(i => i.id === cur.issue.id) || cur.issue;
    const brief = ({ id, title, column, state }) => ({ id, title, column, state });
    const children = all.filter(i => i.parent === me.id).sort((a, b) => a.id.localeCompare(b.id)).map(brief);
    // Relations (issue 058) with title and column, for the drawer.
    const rel = ids => ids.map(x => all.find(i => i.id === x)).filter(Boolean).map(brief);
    const links = { related: rel(me.relatedAll), blocks: rel(me.blocks), blockedBy: rel(blockers(me.blockedOn) || []),
      duplicates: rel(me.duplicates), duplicateOf: rel(me.duplicateOf ? [me.duplicateOf] : []),
      possibleDuplicate: rel(me.state === 'proposed' && me.possibleDuplicate ? [me.possibleDuplicate] : []) };
    // Shape-rule problems of this issue (issue 034), shown as a warning in the drawer.
    let problems = [];
    if (me.state === 'open') try { problems = lint(REPO).filter(x => (x.ids || [x.id]).includes(me.id)).map(x => x.msg); } catch {}
    // Link to the origin note in Obsidian (issue 048): the tracker never reads the vault, it only builds
    // the URL from the validated path and the vault name of the settings page.
    let originUrl = '';
    if (me.originPath) {
      const vault = (await readSettings()).HS_OBSIDIAN_VAULT ?? SCHEMA.HS_OBSIDIAN_VAULT.default;
      originUrl = `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(me.originPath)}`;
    }
    return send(res, 200, { ...me, originUrl, children, links, problems, desc: parsed.desc, commentList: parsed.comments, history: await history(cur.issue.file) });
  }
  if (m && req.method === 'PATCH') return send(res, 200, await updateIssue(m[1], await readJson(req)));
  if (p === '/api/phone-apps' && req.method === 'GET') return send(res, 200, await phoneApps());
  const pa = /^\/api\/phone-apps\/([a-z0-9-]{1,30})$/.exec(p);
  if (pa && req.method === 'POST') return send(res, 200, await markPhoneApp(pa[1], await readJson(req)));
  if (p === '/api/auto' && req.method === 'GET') return send(res, 200, await autoStatus());
  if (p === '/api/auto/run' && req.method === 'POST') return send(res, 202, await autoRun(await readJson(req)));
  if (p === '/api/settings' && req.method === 'GET') return send(res, 200, await getSettings());
  if (p === '/api/settings' && req.method === 'PUT') return send(res, 200, await saveSettings(await readJson(req)));
  send(res, 404, { error: 'not found' });
}

http.createServer((req, res) => {
  handle(req, res).catch(e => {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e instanceof HttpError ? e.code : 500, { error: e instanceof HttpError ? e.message : 'internal error' });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`tracker on 127.0.0.1:${PORT}, repo ${REPO}`));
