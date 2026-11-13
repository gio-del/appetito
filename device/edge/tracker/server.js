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
const PROPOSALS_PER_DAY = { brain: 20, system: 10, question: 10 };
// Questions of the second brain (issue 294): proposals labelled `question`, answered in the tracker; the answer goes
// to a file only brain reads (BRAIN_ANSWERS: tracker writes, group brain reads), never into the vault from here.
const BRAIN_ANSWERS = process.env.TRACKER_BRAIN_ANSWERS || '/var/lib/brain-answers';
const PROPOSER_TOKENS = { brain: 'propose-token', system: 'suggest-token' };
// Scarta reasons (chips in the drawer): `Reject-reason:` header + a comment.
const REJECT_REASONS = ['non mi interessa', 'non ora', 'troppo complessa', 'già coperta', 'sbagliata'];
const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'];
const SESSION_DAYS = 90;
const COOKIE = 'hs_tracker';

// ---------- issue files ----------

const { validateQueueConfig, loadQueueConfig, orderQueue, prioReader, parseLast, srcOf, DEFAULT_QCONFIG, STRATEGIES, projectQueue, pickable, waitingUntil, queueOf, validDay, parse, serialize, getField, setField, now, FILE_RE, COMMENTS_RE, housekeep, lint, blockers, idList, similar, corpus, nextId, backlogAge, parseGitDates, GIT_DATES_ARGS } = require('./issues');

// Who proposed it: `Source:` (set by the tracker from the token); proposals older than the field
// (label "proposed", no Source, no Parent) all came from the second brain. '' = not a proposal.
function sourceOf(p) {
  const s = (getField(p, 'Source') || '').trim();
  if (s === 'system' || s === 'brain') return s;
  if (getField(p, 'Parent')) return ''; // a child written by ops that only inherited the label (issue 258)
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
    // ops-auto's own selector (issue 099): what "Lavora su questa issue" (issue 067) may start.
    pickable: pickable(state, p),
    // `Not before:` still in the future (issue 145): ops-auto skips it until then; not an owner block.
    notBefore: state === 'open' ? waitingUntil(p) : '',
    // Explicit owner choice (issue 478): the automatic backlog cleanup never touches it.
    ownerConfirmed: validDay((getField(p, 'Owner-confirmed') || '').trim()) ? getField(p, 'Owner-confirmed').trim() : '',
    parent: /^\d{3,}$/.test(parentRaw) ? parentRaw : '',
    opened: getField(p, 'Opened') || '', closed: getField(p, 'Closed') || '', origin,
    project: (getField(p, 'Project') || '').trim(),
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
    const id = nextId(REPO);
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
let proposals = { day: '', brain: 0, system: 0, question: 0 };
async function proposeIssue(b, source) {
  const day = now().date;
  if (proposals.day !== day) proposals = { day, brain: 0, system: 0, question: 0 };
  const isQuestion = source === 'brain' && labels(b.labels ?? []).includes('question');
  const kind = isQuestion ? 'question' : source;
  const max = PROPOSALS_PER_DAY[kind];
  if (proposals[kind] >= max) throw new HttpError(429, `max ${max} ${isQuestion ? 'questions' : 'proposals'} a day`);
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
  if (b.project !== undefined && b.project !== '') {
    if (source !== 'system') throw bad('only system proposals name a project');
    const name = oneLine(b.project, 40, 'project');
    let listed = false;
    try { listed = fs.readFileSync(process.env.HS_PROJECTS_FILE || '/etc/hs-projects', 'utf8').split('\n').some(l => l.replace(/#.*/, '').split('|')[0].trim() === name); } catch {}
    if (!listed) throw bad('unknown project');
    setField(p, 'Project', name);
  }
  setField(p, 'Origin', source === 'system' ? `ops-suggest ${day}` : oneLine(b.origin, 300, 'origin'));
  return serial(async () => {
    const id = nextId(REPO);
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
    proposals[kind]++;
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

// Unticked `- [ ] (HITL) …` steps of a description (outside code fences): line index in the description + text.
function hitlSteps(desc) {
  const out = [];
  let fence = false;
  desc.split('\n').forEach((l, line) => {
    if (/^\s*```/.test(l)) fence = !fence;
    const m = !fence && /^\s*[-*] \[ \] (\(HITL\).*)$/.exec(l);
    if (m) out.push({ line, text: m[1].trim() });
  });
  return out;
}

// Rispondi e sblocca (issue 173): answers [{line, text, kind: answer|done, note}] for HITL steps, applied
// to the description in one write: an (owner) comment, the answered steps ticked, and `Blocked on: -` only
// when the first unticked step was answered. Without any HITL step: one answer with line null.
function applyAnswers(p, cur, answers, notes) {
  if (!Array.isArray(answers) || !answers.length || answers.length > 50) throw bad('invalid answers');
  const steps = hitlSteps(p.desc);
  const lines = p.desc.split('\n');
  const changed = () => new HttpError(409, 'la issue è cambiata, ricarica');
  const parts = [];
  let first = false;
  const seen = new Set();
  for (const a of answers) {
    if (typeof a !== 'object' || a === null) throw bad('invalid answer');
    const kind = oneOf(a.kind, ['answer', 'done'], 'kind');
    const note = kind === 'answer' ? text(a.note ?? '', 20000, 'answer').trim() : oneLineOrEmpty(a.note ?? '', 1000, 'note');
    if (kind === 'answer' && !note) throw bad('risposta vuota');
    if (note.split('\n').some(l => /^##? /.test(l))) throw bad('comments cannot contain # or ## headings');
    const body = note.replace(/^### /gm, '#### ');
    if (a.line === null) {
      if (steps.length || kind !== 'answer') throw changed();
      parts.push(`**Risposta**\n${body}`);
      first = true;
      continue;
    }
    if (!Number.isInteger(a.line) || seen.has(a.line)) throw bad('invalid line');
    seen.add(a.line);
    const step = steps.find(s => s.line === a.line);
    if (!step || step.text !== a.text) throw changed();
    lines[a.line] = lines[a.line].replace('[ ]', '[x]');
    if (step === steps[0]) first = true;
    parts.push(`**${step.text}**\n${kind === 'done' ? ['Fatto.', body].filter(Boolean).join(' ') : body}`);
  }
  p.desc = lines.join('\n');
  notes.push(parts.join('\n\n'));
  if (first && /^user\b/i.test(cur.issue.blockedOn || '')) { setField(p, 'Blocked on', '-'); setField(p, 'Owner-confirmed', now().date); }
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
    // A brain question (issue 294) is answered, never approved: the answer is written for brain and the question closes.
    const isQuestion = cur.issue.state === 'proposed' && (getField(p, 'Labels') || '').split(',').some(l => l.trim() === 'question');
    if (isQuestion && (b.approve !== undefined || b.duplicateOf !== undefined)) throw bad('una domanda non si approva: rispondi o scarta');
    if (b.answer !== undefined) {
      if (!isQuestion) throw bad('non è una domanda del brain');
      if (['approve', 'reject', 'column', 'desc', 'backlog', 'duplicateOf', 'answers'].some(k => b[k] !== undefined)) throw bad('answer goes alone');
      const a = text(b.answer, 4000, 'answer').trim();
      if (!a) throw bad('risposta vuota');
      await fsp.mkdir(BRAIN_ANSWERS, { recursive: true });
      await writeAtomic(path.join(BRAIN_ANSWERS, `${id}.json`), JSON.stringify({ id, origin: getField(p, 'Origin') || '', question: p.title, at: `${now().date} ${now().time}`, answer: a }) + '\n');
      const lab = (getField(p, 'Labels') || '').split(',').map(x => x.trim()).filter(Boolean);
      setField(p, 'Labels', [...lab, 'risposta'].join(', '));
      b.column = 'done';
      notes.push('Risposta (inviata al brain): ' + a.replace(/^#{1,3} /gm, '#### '));
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
      // A proposal for another Project is born on that Project's host (issues 161, 189): approving only marks it
      // `Publish: pending`; the gio cron projects-publish-pending creates the GitHub issue (the tracker has no token).
      const publish = cur.issue.state === 'proposed' && col !== 'done' && !!(getField(p, 'Project') || '').trim();
      // A proposal leaves issues/proposed/ only by being approved (any open column) or rejected (done).
      if (col === 'done') {
        state = 'done';
        if (!getField(p, 'Closed')) setField(p, 'Closed', now().date);
        setField(p, 'Blocked on', '-');
      } else {
        state = 'open';
        setField(p, 'Closed', null);
        if (col === 'blocked') {
          setField(p, 'Blocked on', oneLine(b.blockedOn || 'user', 60, 'blockedOn'));
          if (!STATUSES.includes((getField(p, 'Status') || '').trim().toLowerCase())) setField(p, 'Status', 'todo');
        }
        else { setField(p, 'Blocked on', '-'); setField(p, 'Status', col); }
        // The owner picks it (To do / In corso) or sends it back to backlog (issue 478).
        if (col === 'todo' || col === 'in-progress') setField(p, 'Owner-confirmed', now().date);
        else if (col === 'backlog') setField(p, 'Owner-confirmed', null);
        if (publish) { setField(p, 'Blocked on', 'publish'); setField(p, 'Status', 'todo'); setField(p, 'Publish', 'pending'); }
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
    if (b.answers !== undefined) {
      if (cur.issue.state !== 'open') throw bad('non è una issue aperta');
      if (['desc', 'column', 'blockedOn', 'approve', 'reject', 'backlog', 'duplicateOf'].some(k => b[k] !== undefined)) throw bad('answers go alone');
      applyAnswers(p, cur, b.answers, notes);
    }
    // An open issue is never saved without a valid Status (issue 114): moving it to a column sets one.
    if (state === 'open' && !STATUSES.includes((getField(p, 'Status') || '').trim().toLowerCase()))
      throw bad('Status mancante o non valido: spostala in Backlog, Da fare o In corso');
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

// Scheduled jobs per category (issue 224): jobs-status (hs-monitor) writes JOBS_STATUS; plain fields only.
const JOBS_STATUS = process.env.TRACKER_JOBS_STATUS || '/var/lib/edge-status/jobs.json';
async function jobsStatus() {
  try { return JSON.parse(await fsp.readFile(JOBS_STATUS, 'utf8')); } catch { return { generated: 0, categories: {} }; }
}

// Issues of the Projects hosted on GitHub (issue 091): read-only mirror written by projects-issues-sync
// ($HS_USER's cron, the only reader of the GitHub token). Ids are always "<project>#<number>", never
// local numbers. The text is untrusted: only plain fields are passed on, links only to github.com.
const PROJECTS_ISSUES = process.env.TRACKER_PROJECTS_ISSUES || '/var/lib/edge-status/projects-issues.json';
async function projectsIssues() {
  let src;
  try { src = JSON.parse(await fsp.readFile(PROJECTS_ISSUES, 'utf8')); } catch { return { updated: '', projects: {} }; }
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const projects = {};
  for (const [name, p] of Object.entries(src.projects || {})) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name) || !p || typeof p !== 'object') continue;
    const issues = (Array.isArray(p.issues) ? p.issues : []).filter(i => Number.isInteger(i.number)).map(i => ({
      id: `${name}#${i.number}`, number: i.number, title: str(i.title, 200), state: i.state === 'closed' ? 'closed' : 'open',
      url: /^https:\/\/github\.com\//.test(i.url) ? i.url.slice(0, 300) : '', author: str(i.author, 60),
      labels: (Array.isArray(i.labels) ? i.labels : []).map(l => str(l, 50)).filter(Boolean).slice(0, 10),
      updated: str(i.updated, 30), trusted: i.trust === 'author' || i.trust === 'self-assigned', trust: i.trust || '' }));
    projects[name] = { repo: str(p.repo, 100), error: str(p.error, 100), stale: !!p.stale, issues };
  }
  return { updated: str(src.updated, 20), projects };
}

// Writing to those issues (issue 184): the tracker has no GitHub token. It validates the request against
// the mirror (Project and issue must be in it) and drops <id>.req.json in PROJECTS_WRITES; $HS_USER's
// projects-issue-apply (cron, every minute) re-reads the issue on GitHub, writes, and answers <id>.res.json.
const PROJECTS_WRITES = process.env.TRACKER_PROJECTS_WRITES || '/var/lib/projects-writes';
const WRITE_ACTIONS = ['comment', 'read', 'answer','close', 'reopen', 'label-add', 'label-remove'];
async function projectsWrite(b) {
  const name = typeof b.project === 'string' ? b.project : '';
  const number = b.number;
  const mirror = (await projectsIssues()).projects[name];
  if (!mirror || !Number.isInteger(number) || !mirror.issues.some(i => i.number === number)) throw bad('issue sconosciuta');
  if (!WRITE_ACTIONS.includes(b.action)) throw bad('azione non valida');
  const req = { id: crypto.randomBytes(8).toString('hex'), at: Math.floor(Date.now() / 1000), project: name, number, action: b.action };
  if (b.action === 'comment') {
    if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 4000) throw bad('commento vuoto o troppo lungo (max 4000 caratteri)');
    req.text = b.text;
  } else if (b.action === 'read' || b.action === 'answer') {
    // Only the owner's issues (trust, issue 160); projects-issue-apply checks again against the mirror.
    if (!mirror.issues.find(i => i.number === number).trusted) throw bad('issue non fidata: niente risposta');
    if (b.action === 'answer') {
      const a = b.answers;
      if (!Array.isArray(a) || a.length < 1 || a.length > 20) throw bad('risposta vuota');
      let total = 0;
      req.answers = a.map(x => {
        const text = typeof x?.text === 'string' ? x.text : '', note = typeof x?.note === 'string' ? x.note : '';
        if ((x?.kind !== 'answer' && x?.kind !== 'done') || text.length > 200 || note.length > 2000 || (x.kind === 'answer' && !note.trim())) throw bad('risposta non valida');
        total += text.length + note.length;
        return { text, kind: x.kind, note: note.trim() };
      });
      if (total > 4000) throw bad('risposta troppo lunga (max 4000 caratteri)');
    }
  } else if (b.action.startsWith('label-')) {
    if (typeof b.label !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,49}$/.test(b.label)) throw bad('etichetta non valida');
    req.label = b.label;
  }
  const waiting = (await fsp.readdir(PROJECTS_WRITES).catch(() => [])).filter(f => f.endsWith('.req.json')).length;
  if (waiting >= 50) throw new HttpError(429, 'troppe richieste in coda');
  await writeAtomic(path.join(PROJECTS_WRITES, `${req.id}.req.json`), JSON.stringify(req) + '\n');
  return { id: req.id };
}
async function projectsWriteResult(id) {
  try {
    const r = JSON.parse(await fsp.readFile(path.join(PROJECTS_WRITES, `${id}.res.json`), 'utf8'));
    const out = { done: true, ok: r.ok === true, msg: typeof r.msg === 'string' ? r.msg.slice(0, 300) : '' };
    if (Array.isArray(r.steps)) { // answer to a "read": what the owner is asked (plain text)
      out.steps = r.steps.filter(s => typeof s === 'string').slice(0, 20).map(s => s.slice(0, 200));
      out.last = { by: String(r.last?.by || '').slice(0, 60), text: String(r.last?.text || '').slice(0, 1500) };
      out.needs_owner = r.needs_owner === true;
    }
    return out;
  } catch {}
  let at = 0;
  try { at = JSON.parse(await fsp.readFile(path.join(PROJECTS_WRITES, `${id}.req.json`), 'utf8')).at; } catch { throw new HttpError(404, 'richiesta sconosciuta'); }
  return Date.now() / 1000 - at > 660 ? { done: true, ok: false, msg: 'nessuna risposta: il lavoro sul server non è partito, riprova' } : { done: false };
}

// ---------- Domande aperte verso l'owner, a flashcard (issue 352, epic 351) ----------
// One card per open question: an unticked `- [ ] (HITL)` step of a local open issue (or, with `Blocked on: user`
// and no step, the issue itself), and every trusted `needs-owner` issue of a Project (its steps are read by the
// page through projects-issue-apply, issue 307). «Non ancora» hides a card for a day: state in STATE, not in the issue.
const QUESTIONS_SNOOZE = path.join(STATE, 'questions-snooze.json');
const SNOOZE_MS = 86400e3;
// Suggested answers (issue 353): questions-suggest ($HS_USER's cron) reads WANTED and writes <hash>.json next to it.
// The hash changes with the question (step + last comment), so a changed question gets a new suggestion.
const SUGGESTIONS = process.env.TRACKER_SUGGESTIONS || '/var/lib/question-suggestions';
const sha16 = t => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);
async function readSuggestion(hash) {
  try {
    const j = JSON.parse(await fsp.readFile(path.join(SUGGESTIONS, hash + '.json'), 'utf8'));
    if (!j || typeof j.answer !== 'string' || typeof j.why !== 'string' || !j.answer.trim()) return null;
    const clean = (t, n) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
    return { answer: clean(j.answer, 400), why: clean(j.why, 160), model: typeof j.model === 'string' ? clean(j.model, 20) : '' };
  } catch { return null; }
}
// Answers found by themselves (issue 354): questions-recheck writes found.json {issue id: {ok, check, evidence}};
// only a true result is shown, as text on the card. Nothing is closed by it.
async function readFound() {
  try {
    const j = JSON.parse(await fsp.readFile(path.join(SUGGESTIONS, 'found.json'), 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}
async function publishWanted(cards) {
  const text = JSON.stringify(cards.map(c => ({ hash: c.hash, key: c.key, kind: c.kind, title: c.title, step: c.step, context: c.context, last: c.last ? c.last.text : '' }))) + '\n';
  if (text === lastWanted) return;
  try { await writeAtomic(path.join(SUGGESTIONS, 'wanted.json'), text); lastWanted = text; } catch {}
}
let lastWanted = '';
async function snoozed() {
  let j = {};
  try { j = JSON.parse(await fsp.readFile(QUESTIONS_SNOOZE, 'utf8')); } catch {}
  const t = Date.now(), out = {};
  for (const [k, until] of Object.entries(j)) if (Number.isFinite(until) && until > t) out[k] = until;
  return out;
}
async function questions() {
  const snz = await snoozed();
  const cards = [];
  const today = now().date;
  for (const f of await listFiles()) {
    if (f.state !== 'open') continue;
    const x = await load(f.state, f.file).catch(() => null);
    if (!x) continue;
    const p = parse(x.text), i = x.issue;
    const steps = hitlSteps(p.desc);
    const waits = /^user\b/i.test(i.blockedOn || '');
    if (!steps.length && !waits) continue;
    const ra = (getField(p, 'Risk-accepted') || '').trim();
    if (!steps.length && /^\d{4}-\d{2}-\d{2}$/.test(ra) && ra > today) continue;
    let intro = p.desc.split('\n').filter(l => !/^#{1,6} /.test(l) && !/^\s*[-*] \[[ x]\]/.test(l)).join('\n').trim().slice(0, 600);
    const lastC = p.comments[p.comments.length - 1];
    // The AI's latest "## Per te (DATE)" section replaces the oldest text of the issue (issue 401).
    let ai = null;
    const secs = [...p.desc.matchAll(/^## Per te \((\d{4}-\d{2}-\d{2})\)[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)];
    if (secs.length) {
      const m = secs[secs.length - 1];
      const body = m[2].split('\n').filter(l => !/^\s*[-*] \[[ x]\]/.test(l)).join('\n').trim().slice(0, 600);
      if (body) { ai = { date: m[1], newer: !!(lastC && m[1] >= String(lastC.date || '').slice(0, 10)) }; intro = body; }
    }
    const nb = getField(p, 'Not before');
    const base = { kind: 'local', issue: i.id, title: i.title, column: i.column, version: i.version, opened: i.opened, blocks: 0,
      expired: !!(nb && /^\d{4}-\d{2}-\d{2}$/.test(nb.trim()) && nb.trim() <= today), context: intro, ai, blockedOn: i.blockedOn,
      last: lastC ? { by: String(lastC.author || '').slice(0, 60), text: String(lastC.text || '').slice(0, 800) } : null };
    for (const s of steps.length ? steps : [null]) cards.push({ ...base, key: `${i.id}|${s ? s.text.slice(0, 80) : '*'}`, line: s ? s.line : null, step: s ? s.text : '' });
  }
  const all = await listIssues();
  for (const c of cards) c.blocks = (all.find(i => i.id === c.issue)?.blocks || []).length;
  const pj = await projectsIssues();
  for (const [name, p] of Object.entries(pj.projects)) {
    for (const i of p.issues) if (i.state === 'open' && i.trusted && i.labels.includes('needs-owner'))
      cards.push({ kind: 'project', key: `${i.id}`, project: name, number: i.number, issue: i.id, title: i.title, url: i.url, opened: (i.updated || '').slice(0, 10), blocks: 0, expired: false, context: '', last: null, step: '', line: null });
  }
  for (const c of cards) c.hash = sha16(`${c.key}\n${c.step}\n${c.last ? c.last.text : c.title}`);
  await publishWanted(cards.filter(c => !snz[c.key]));
  const found = await readFound();
  for (const c of cards) {
    const f = c.kind === 'local' ? found[c.issue] : null;
    if (f && f.ok === true && typeof f.evidence === 'string') c.found = { evidence: f.evidence.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) };
  }
  for (const c of cards) { const sg = await readSuggestion(c.hash); if (sg) c.suggestion = sg; }
  const live = cards.filter(c => !snz[c.key]);
  live.sort((a, b) => (b.blocks > 0) - (a.blocks > 0) || b.expired - a.expired || (a.opened || '9').localeCompare(b.opened || '9') || a.key.localeCompare(b.key));
  return { cards: live, snoozed: cards.length - live.length };
}
function snoozeQuestion(b) {
  return serial(async () => {
    if (typeof b.key !== 'string' || b.key.length > 200) throw bad('invalid key');
    if (!(await questions()).cards.some(c => c.key === b.key)) throw new HttpError(404, 'domanda sconosciuta');
    const j = await snoozed();
    j[b.key] = Date.now() + SNOOZE_MS;
    await writeAtomic(QUESTIONS_SNOOZE, JSON.stringify(j) + '\n');
    return { ok: true };
  });
}

// Release PRs of the Projects (issues 208, 209): release-gate ($HS_USER's cron) writes RELEASE_STATE; the
// tracker only shows it (plain fields, github.com links) and drops "Rimanda" as <project>.req.json in
// RELEASE_REQ, which release-gate reads while the release is announced (and deletes).
const RELEASE_STATE = process.env.TRACKER_RELEASE_STATE || '/var/lib/edge-status/release-gate.json';
const RELEASE_REQ = process.env.TRACKER_RELEASE_REQ || '/var/lib/release-req';
async function releases() {
  let src;
  try { src = JSON.parse(await fsp.readFile(RELEASE_STATE, 'utf8')); } catch { return { updated: 0, paused: false, projects: {} }; }
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const num = v => (Number.isFinite(v) ? v : 0);
  const projects = {};
  for (const [name, p] of Object.entries(src.projects || {})) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name) || !p || typeof p !== 'object') continue;
    let pending = false;
    try { const r = JSON.parse(await fsp.readFile(path.join(RELEASE_REQ, `${name}.req.json`), 'utf8')); pending = Date.now() / 1000 - num(r.at) < 259200; } catch {}
    projects[name] = { status: ['none', 'waiting', 'announced', 'postponed', 'serve-owner', 'released'].includes(p.status) ? p.status : 'none',
      version: str(p.version, 30), pr: Number.isInteger(p.pr) ? p.pr : 0, url: /^https:\/\/github\.com\//.test(p.url) ? p.url.slice(0, 300) : '',
      changelog: str(p.changelog, 3000), last_tag: str(p.last_tag, 40), last_at: str(p.last_at, 30),
      rules: (Array.isArray(p.rules) ? p.rules : []).slice(0, 20).map(r => ({ rule: str(r.rule, 20), ok: r.ok === true, why: str(r.why, 200) })),
      announced_at: num(p.announced_at), release_at: num(p.release_at), postponed_until: num(p.postponed_until), released_at: num(p.released_at),
      paused: !!p.paused, stale: !!p.stale, note: str(p.note, 120), error: str(p.error, 200), pending };
  }
  return { updated: num(src.updated), paused: !!src.paused, now: Math.floor(Date.now() / 1000), projects };
}
// Green PRs of the Projects that the server does not merge (issue 349): projects-ci-watch writes PRS_TO_MERGE; plain fields, github.com links.
async function prsToMerge() {
  let src;
  try { src = JSON.parse(await fsp.readFile(PRS_TO_MERGE, 'utf8')); } catch { return { updated: 0, prs: [] }; }
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const prs = (Array.isArray(src.prs) ? src.prs : []).filter(x => x && /^[a-z0-9][a-z0-9-]{0,40}$/.test(x.project) && Number.isInteger(x.pr)).slice(0, 50)
    .map(x => ({ project: x.project, issue: Number.isInteger(x.issue) ? x.issue : 0, pr: x.pr, url: /^https:\/\/github\.com\//.test(x.url) ? x.url.slice(0, 300) : '', title: str(x.title, 100), reason: str(x.reason, 200), since: Number.isFinite(x.since) ? x.since : 0 }));
  return { updated: Number.isFinite(src.updated) ? src.updated : 0, prs };
}
async function releasePostpone(b) {
  const name = typeof b.project === 'string' ? b.project : '';
  const p = (await releases()).projects[name];
  if (!p || p.status !== 'announced') throw new HttpError(409, 'nessun rilascio annunciato per questo Progetto');
  // idempotent: the same file is rewritten, so repeated taps never queue twice
  await writeAtomic(path.join(RELEASE_REQ, `${name}.req.json`), JSON.stringify({ project: name, at: Math.floor(Date.now() / 1000) }) + '\n');
  return { ok: true };
}

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

// ---------- Mail bridge (/mail.html, issue 015) ----------
// mail-setup makes MAIL_SETUP (tracker writes: url.json, test.json; mailer reads) and MAIL_STATUS (mailer writes
// status.json and, until its first good answer, edge-mail.gs: the Apps Script with its secret, for the owner to copy).
// The tracker never calls Google itself; mail-fetch (cron, every 2 minutes) does.

const MAIL_SETUP = process.env.TRACKER_MAIL_SETUP || '/var/lib/mail-setup';
const MAIL_STATUS = process.env.TRACKER_MAIL_STATUS || '/var/lib/mail-status';
const MAIL_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/;
const readJsonFile = async f => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return null; } };

async function mailStatus() {
  const enabled = await fsp.access(MAIL_SETUP).then(() => true, () => false);
  if (!enabled) return { enabled: false };
  const conf = await readJsonFile(path.join(MAIL_SETUP, 'url.json'));
  const test = await readJsonFile(path.join(MAIL_SETUP, 'test.json'));
  const status = await readJsonFile(path.join(MAIL_STATUS, 'status.json'));
  let script = null;
  try { script = await fsp.readFile(path.join(MAIL_STATUS, 'edge-mail.gs'), 'utf8'); } catch {}
  const testPending = !!(test && test.at && !(status && status.test && status.test.at >= test.at));
  // The copy is back after a good answer only when the published script is older than the template (mail-setup, issue 415).
  const update = !!(script && conf && conf.url && status && status.lastOk);
  return { enabled, url: (conf && conf.url) || '', urlAt: (conf && conf.at) || 0, script, status, testPending, update };
}

function setMailUrl(b) { return serial(async () => {
  if (!(await mailStatus()).enabled) throw new HttpError(409, 'il collegamento mail non è attivo sul server');
  if (typeof b.url !== 'string') throw bad('indirizzo mancante');
  const url = b.url.trim();
  const f = path.join(MAIL_SETUP, 'url.json');
  if (!url) { await fsp.unlink(f).catch(() => {}); return { ok: true, url: '' }; }
  if (!MAIL_URL_RE.test(url)) throw bad("l'indirizzo deve essere quello dell'app web: https://script.google.com/macros/s/…/exec");
  await writeAtomic(f, JSON.stringify({ url, at: Math.floor(Date.now() / 1000) }) + '\n');
  return { ok: true, url };
}); }

function mailTest() { return serial(async () => {
  const s = await mailStatus();
  if (!s.enabled || !s.url) throw new HttpError(409, "prima salva l'indirizzo dello script");
  const f = path.join(MAIL_SETUP, 'test.json');
  const prev = await readJsonFile(f);
  const t = Math.floor(Date.now() / 1000);
  if (prev && t - prev.at < 60) throw new HttpError(429, 'una prova al minuto: aspetta un momento');
  await writeAtomic(f, JSON.stringify({ at: t }) + '\n');
  return { ok: true, at: t };
}); }

// ---------- Automatic maintenance status and manual start (/auto.html, issue 067) ----------
// ops-auto-card ($HS_USER) writes AUTO_STATUS; "Avvia ora" writes AUTO_REQUEST ({id, at, issue}),
// which $HS_USER's ops-auto-request (cron, every minute) answers by starting `ops-auto --manual`
// and echoing the id back in AUTO_STATUS.request. The tracker never runs anything itself.

const AUTO_STATUS = process.env.TRACKER_AUTO_STATUS || '/var/lib/edge-status/ops-auto.json';
const AUTO_REQUEST = process.env.TRACKER_AUTO_REQUEST || '/var/lib/ops-auto-req/request.json';
// Log of the current/last run (issue 104): written by ops-auto-card (redacted inputs, no outputs),
// readable by the tracker only; served to the owner session, never via Caddy's static files.
const AUTO_LOG = process.env.TRACKER_AUTO_LOG || '/var/lib/ops-auto-log/run.json';
// Same for the daily proposals (ops-suggest, issue 107).
const SUGGEST_LOG = process.env.TRACKER_SUGGEST_LOG || '/var/lib/ops-auto-log/suggest.json';
// Claude usage of the last 7 days (issue 131): numbers only, written hourly by claude-usage --card.
const AUTO_USAGE = process.env.TRACKER_AUTO_USAGE || '/var/lib/edge-status/usage.json';
// Cost/quality signals (issue 298): numbers and issue ids, written hourly by ops-suggest-signals --card.
const AUTO_SIGNALS = process.env.TRACKER_AUTO_SIGNALS || '/var/lib/edge-status/signals.json';
const AUTO_PER_HOUR = 6;
let autoStarts = [];

async function autoStatus() {
  let status = null, req = null;
  try { status = JSON.parse(await fsp.readFile(AUTO_STATUS, 'utf8')); } catch {}
  try { req = JSON.parse(await fsp.readFile(AUTO_REQUEST, 'utf8')); } catch {}
  // Pending: written here, not answered yet and not stale (the job refuses after 10 minutes).
  const pending = req && (!status || !status.request || status.request.id !== req.id) && Date.now() / 1000 - req.at < 660 ? req : null;
  if (status) await withQueue(status);
  return { status, pending, now: Math.floor(Date.now() / 1000) };
}

// Queue strategy (issue 225): config JSON written here, read by ops-auto (issues.js --order); the order is always
// computed by issues.js orderQueue, here only for display and the preview (without ops-auto's CI/PR waits).
const QUEUE_CONFIG = process.env.TRACKER_QUEUE_CONFIG || '/var/lib/hs-settings/queue.json';
const PROJECTS_LIST = () => process.env.HS_PROJECTS_FILE || '/etc/hs-projects';
async function queueSources() {
  try { return (await fsp.readFile(PROJECTS_LIST(), 'utf8')).split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('|')[0].trim()).filter(Boolean); } catch { return ['home-server']; }
}
async function readQueueConfig() { return loadQueueConfig(QUEUE_CONFIG); }
async function queueIds(open, last, cfg) {
  const entries = queueOf(open).map(i => ({ id: i.file, h: /\bmonitor\b/.test(getField(i.p, 'Labels') || '') }));
  if (process.env.HS_QUEUE_PROJECTS_JSON)
    for (const id of projectQueue(process.env.HS_QUEUE_PROJECTS_JSON, PROJECTS_LIST())) entries.push({ id, h: false });
  return orderQueue(entries, cfg, last, prioReader(REPO, process.env.HS_QUEUE_PROJECTS_JSON || ''));
}
async function openIssues() {
  const open = [];
  for (const file of await fsp.readdir(DIRS.open).catch(() => [])) {
    if (!FILE_RE.test(file)) continue;
    try { open.push({ state: 'open', file, p: parse(await fsp.readFile(path.join(DIRS.open, file), 'utf8')) }); } catch {}
  }
  return open;
}
async function queueConfigView(cfg, status) {
  const sources = await queueSources();
  const open = await openIssues();
  const last = status && status.rr && status.rr.src ? { src: status.rr.src, used: status.rr.used } : {};
  const wait = new Set(((status && status.waiting) || []).map(w => w.id.replace('#', '-')));
  const ids = (await queueIds(open, last, cfg)).filter(f => !wait.has(f));
  const titles = new Map(open.map(i => [i.file, (i.p.title || i.file).slice(0, 160)]));
  let mirror = {}; try { mirror = JSON.parse(await fsp.readFile(process.env.HS_QUEUE_PROJECTS_JSON || '', 'utf8')); } catch {}
  const prio = prioReader(REPO, process.env.HS_QUEUE_PROJECTS_JSON || '');
  const entry = f => {
    const id = /\.md$/.test(f) ? FILE_RE.exec(f)[1] : f.replace(/-(\d+)$/, '#$1');
    let title = titles.get(f);
    if (!title) { const [n, num] = id.split('#'); const it = (((mirror.projects || {})[n] || {}).issues || []).find(x => String(x.number) === num); title = String((it && it.title) || id).slice(0, 160); }
    return { id, title, source: srcOf(f), priority: prio(f) || 'none' };
  };
  return { config: cfg, sources, strategies: STRATEGIES, preview: ids.slice(0, 10).map(entry), total: ids.length };
}
async function getQueueConfig() {
  let status = null; try { status = JSON.parse(await fsp.readFile(AUTO_STATUS, 'utf8')); } catch {}
  return queueConfigView(await readQueueConfig(), status);
}
// Body {config}: validated (known strategy, weights 1-5, only sources listed in projects); preview=true does not save.
function saveQueueConfig(b, preview) { return serial(async () => {
  let cfg; try { cfg = validateQueueConfig(b && b.config, await queueSources()); } catch (e) { throw bad(e.message); }
  if (!preview) await writeAtomic(QUEUE_CONFIG, JSON.stringify(cfg, null, 1) + '\n');
  let status = null; try { status = JSON.parse(await fsp.readFile(AUTO_STATUS, 'utf8')); } catch {}
  return queueConfigView(cfg, status);
}); }

// The queue as of now (issue 099): ops-auto-card writes it at most once a minute, so an issue just put in
// To do would be missing; every status fetch (the header pill too) recomputes it with ops-auto's selector.
async function withQueue(status) {
  const open = [];
  for (const file of await fsp.readdir(DIRS.open).catch(() => [])) {
    if (!FILE_RE.test(file)) continue;
    try { open.push({ state: 'open', file, p: parse(await fsp.readFile(path.join(DIRS.open, file), 'utf8')) }); } catch {}
  }
  const wait = new Set((status.waiting || []).map(w => w.id.replace('#', '-')));
  const ids = (await queueIds(open, status.rr && status.rr.src ? { src: status.rr.src, used: status.rr.used } : {}, await readQueueConfig())).filter(f => !wait.has(f));
  const local = new Map(queueOf(open).map(i => [i.file, i]));
  let mirror = {}; try { mirror = JSON.parse(await fsp.readFile(process.env.HS_QUEUE_PROJECTS_JSON || '', 'utf8')); } catch {}
  const items = ids.map(f => {
    const i = local.get(f);
    if (i) return { id: FILE_RE.exec(f)[1], title: (i.p.title || f).slice(0, 160),
      priority: (getField(i.p, 'Priority') || 'none').trim().split(/\s+/)[0], monitor: /\bmonitor\b/.test(getField(i.p, 'Labels') || '') };
    const id = f.replace(/-(\d+)$/, '#$1'), [name, num] = id.split('#');
    const it = (((mirror.projects || {})[name] || {}).issues || []).find(x => String(x.number) === num);
    return { id, title: String((it && it.title) || id).slice(0, 160), priority: 'none', monitor: false, project: name };
  });
  status.queue = items.slice(0, 10);
  status.queueTotal = items.length;
  // The state code the card derived from its own (older) queue, same order of checks as ops-auto-card.
  const idle = () => status.repo && status.repo.dirty ? 'dirty' : status.repo && status.repo.freeAt > Date.now() / 1000 ? 'busy' : 'idle';
  if (status.code === 'empty' && status.queueTotal) status.code = idle();
  else if (['dirty', 'busy', 'idle'].includes(status.code) && !status.queueTotal) status.code = 'empty';
}

async function autoUsage() {
  try { return JSON.parse(await fsp.readFile(AUTO_USAGE, 'utf8')); } catch { return { v: 1, missing: true }; }
}

async function autoSignals() {
  try { return JSON.parse(await fsp.readFile(AUTO_SIGNALS, 'utf8')); } catch { return { v: 1, missing: true }; }
}

async function autoLog() {
  try { return JSON.parse(await fsp.readFile(AUTO_LOG, 'utf8')); } catch { return { v: 1, entries: [], total: 0, missing: true }; }
}

async function suggestLog() {
  let L; try { L = JSON.parse(await fsp.readFile(SUGGEST_LOG, 'utf8')); } catch { L = { v: 1, entries: [], total: 0, missing: true }; }
  // Projects whose proposals the owner paused (issue 271): from ops-suggest's status file.
  try {
    const s = JSON.parse(await fsp.readFile(process.env.TRACKER_SUGGEST_STATUS || '/var/lib/edge-status/suggest.json', 'utf8'));
    L.paused = (Array.isArray(s.paused) ? s.paused : []).filter(x => typeof x === 'string' && /^[\w.-]{1,40}$/.test(x));
    L.slots = (s.slots && typeof s.slots === "object") ? { morning: String(s.slots.morning || "").slice(0, 10), evening: String(s.slots.evening || "").slice(0, 10), evening_hour: String(s.slots.evening_hour || "").slice(0, 2) } : null;
  } catch { L.paused = []; }
  return L;
}

// A Project issue (issue 205): open in the mirror, trusted author, and in ops-auto's queue (Project listed and enabled).
async function autoRunProject(id) {
  const [name, num] = id.split('#');
  const it = ((await projectsIssues()).projects[name] || { issues: [] }).issues.find(x => String(x.number) === num);
  if (!it) throw new HttpError(404, 'issue non trovata');
  if (it.state !== 'open') throw new HttpError(409, 'la issue è chiusa');
  if (!it.trusted) throw new HttpError(409, 'issue non fidata: la manutenzione automatica lavora solo su quelle del proprietario');
  const q = process.env.HS_QUEUE_PROJECTS_JSON ? projectQueue(process.env.HS_QUEUE_PROJECTS_JSON, process.env.HS_PROJECTS_FILE || '/etc/hs-projects') : [];
  if (!q.includes(`${name}-${num}`)) throw new HttpError(409, 'questa issue non è lavorabile dalla manutenzione automatica (Project non abilitato, issue bloccata, epic o in attesa del proprietario)');
  return id;
}
function autoRun(b) { return serial(() => autoRunNow(b)); }
async function autoRunNow(b) {
  let issue = null;
  if (b.issue != null && b.issue !== '') {
    if (typeof b.issue === 'string' && /^[a-z0-9][a-z0-9-]{0,40}#\d{1,6}$/.test(b.issue)) issue = await autoRunProject(b.issue);
    else {
      if (typeof b.issue !== 'string' || !/^\d{3,4}$/.test(b.issue)) throw bad('issue non valida');
      const i = (await listIssues()).find(x => x.id === b.issue);
      if (!i) throw new HttpError(404, 'issue non trovata');
      if (!i.pickable) throw new HttpError(409, 'questa issue non è lavorabile dalla manutenzione automatica (aperta, Da fare o In corso, non bloccata, non epic, Not before passato)');
      issue = i.id;
    }
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

// ---------- App dei Projects: Riaccendi / Sempre accesa (issue 477) ----------
// State is apps-idle's (world-readable /var/lib/apps-idle); a request is a one-word file that root's apps-idle applies.
const APPS_STATE = process.env.TRACKER_APPS_STATE || '/var/lib/apps-idle';
const APPS_REQ = process.env.TRACKER_APPS_REQ || '/var/lib/apps-idle-req';
const APPS_PROJECTS = process.env.HS_PROJECTS_FILE || '/etc/hs-projects';
const APP_FEATURES = ['proposte', 'domande', 'smistamento', 'cv']; // issue 480: same list and state files as the apps (apps-idle FEATURES)
async function projectApps() {
  let t = ''; try { t = await fsp.readFile(APPS_PROJECTS, 'utf8'); } catch {}
  return t.split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.split('|').map(x => x.trim())[2]).filter(a => a && a !== '-' && /^[a-z0-9-]{1,40}$/.test(a));
}
async function appsStatus() {
  const rd = async f => { try { return (await fsp.readFile(path.join(APPS_STATE, f), 'utf8')).trim(); } catch { return null; } };
  const apps = [];
  for (const a of [...(await projectApps()), ...APP_FEATURES]) {
    const off = await rd(a + '.off');
    apps.push({ app: a, off: /^\d{4}-\d\d-\d\d$/.test(off || '') ? off : '', always: (await rd(a + '.always')) !== null, new: (await rd(a + '.new')) !== null, feature: APP_FEATURES.includes(a) });
  }
  return { apps };
}
async function appsAction(b) {
  if (!b || typeof b.app !== 'string' || ![...(await projectApps()), ...APP_FEATURES].includes(b.app)) throw bad('app sconosciuta');
  if (!(APP_FEATURES.includes(b.app) ? ['on', 'always', 'auto'] : ['on', 'trial', 'always', 'auto']).includes(b.action)) throw bad('azione non valida');
  await fsp.mkdir(APPS_REQ, { recursive: true });
  await writeAtomic(path.join(APPS_REQ, b.app), b.action + '\n');
  return { ok: true };
}

// ---------- Cosa è successo (/recent.html, issue 326) ----------
// Last 7 days, by day, from files already there: Closed: of issues/done, rejected proposals, outcomes of deploy.log
// (copied by the deploy into edge-status: the tracker cannot read gio's home). Only ids, titles, dates and the
// deploy's fixed short outcome; never log text.
const DEPLOY_LOG = process.env.TRACKER_DEPLOY_LOG || '/var/lib/edge-status/deploy.log';
const RECENT_DAYS = 7;
async function recent() {
  const since = new Date(Date.now() - (RECENT_DAYS - 1) * 864e5).toISOString().slice(0, 10);
  let byIssue = {};
  try { byIssue = JSON.parse(await fsp.readFile(AUTO_USAGE, 'utf8')).byIssue || {}; } catch {}
  const days = new Map();
  const day = d => { if (!days.has(d)) days.set(d, { date: d, closed: [], rejected: [], deploys: [] }); return days.get(d); };
  for (const i of await listIssues()) {
    if (i.state !== 'done' || !/^\d{4}-\d\d-\d\d$/.test(i.closed) || i.closed < since) continue;
    const c = byIssue[i.id], item = { id: i.id, title: i.title };
    if (c && Number.isFinite(c.costUsd)) Object.assign(item, { costUsd: c.costUsd, runs: c.runs, attempts: c.attempts });
    day(i.closed)[i.labels.includes('scartata') ? 'rejected' : 'closed'].push(item);
  }
  let log = '';
  try { log = await fsp.readFile(DEPLOY_LOG, 'utf8'); } catch {}
  for (const line of log.split('\n').slice(-500)) {
    const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d):\d\d (ok|failed (check|install)(?:: ([a-z0-9_.:-]{1,40}))?)$/.exec(line);
    if (!m || m[1] < since) continue;
    day(m[1]).deploys.push({ time: m[2], ok: m[3] === 'ok', phase: m[4] || '', reason: m[5] || '' });
  }
  const list = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
  for (const d of list) { d.closed.sort((a, b) => b.id.localeCompare(a.id)); d.deploys.sort((a, b) => b.time.localeCompare(a.time)); }
  return { days: list, since };
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

// ---------- Watch summary (GET /api/watch, issue 290, epic 287) ----------
// Read-only digest for the smartwatch app. Its own bearer token (sha256 in $TRACKER_STATE/watch-token, written by
// tracker-setup) works only here; the owner session and the proposers' tokens do not. Counts, the 3 most urgent titles and
// up to 5 titles per category with the tracker's own ids (`#336 title`, `sumisura#243 title`), never issue bodies or vault content. A source older than its limit is `stale` and `ok` is false.
const WATCH_STATUS = process.env.TRACKER_WATCH_STATUS || '/var/lib/edge-status/status.json';
const WATCH_HEALTH = process.env.TRACKER_WATCH_HEALTH || '/var/lib/edge-status/health.json';
const WATCH_PROBES = ['Syncthing', 'Vaultwarden', 'AdGuard Home', 'Issue tracker', 'Calendario e attività', 'Sumisura', 'Libreria', 'Notifiche (ntfy)'];
const WATCH_TITLE_MAX = 160, WATCH_ITEMS_MAX = 5;
const WATCH_PROJECT_CD = process.env.TRACKER_PROJECT_CD || '/var/lib/edge-status/project-cd.json';
const PRS_TO_MERGE = process.env.TRACKER_PRS_TO_MERGE || '/var/lib/edge-status/prs-to-merge.json'; // projects-ci-watch (issue 349)
const WATCH_MAX_AGE = { health: 600, status: 600, auto: 900, release: 5400, jobs: 600 }; // seconds
function watchAuthed(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{32,})$/.exec(req.headers.authorization || '');
  if (!m) return false;
  let want;
  try { want = Buffer.from(fs.readFileSync(path.join(STATE, 'watch-token'), 'utf8').trim(), 'hex'); } catch { return false; }
  const got = Buffer.from(sha(m[1]), 'hex');
  return want.length === 32 && crypto.timingSafeEqual(got, want);
}
const wclean = (s, n) => String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
async function readSource(file) {
  try {
    const [txt, st] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]);
    const j = JSON.parse(txt);
    const t = [j.updated, j.checked, j.generated].find(v => Number.isFinite(v) && v > 1e9) ?? Math.floor(st.mtimeMs / 1000);
    return { j, t };
  } catch { return { j: null, t: 0 }; }
}
async function watchSummary() {
  const nowS = Math.floor(Date.now() / 1000);
  const [health, status, auto, rel, jobs] = await Promise.all([WATCH_HEALTH, WATCH_STATUS, AUTO_STATUS, RELEASE_STATE, JOBS_STATUS].map(readSource));
  const age = (src, key) => { const a = src.j ? Math.max(0, nowS - src.t) : null; return { age: a, stale: a === null || a > WATCH_MAX_AGE[key] }; };
  const fresh = { health: age(health, 'health'), status: age(status, 'status'), auto: age(auto, 'auto'), release: age(rel, 'release'), jobs: age(jobs, 'jobs') };

  // Titles by urgency (services down, releases, owner steps, proposals): `titles` = the first 3 in all, `items` = up to 5 per category.
  const tt = { down: [], rel: [], owner: [], prop: [] };
  const addTitle = (k, t) => tt[k].push(wclean(t, WATCH_TITLE_MAX));
  const all = await Promise.all((await listFiles()).filter(f => f.state !== 'done').map(f => load(f.state, f.file).catch(() => null)));
  let proposals = 0, owner = 0;
  for (const x of all) {
    if (!x) continue;
    if (x.issue.state === 'proposed') { proposals++; addTitle('prop', `#${x.issue.id} ${x.issue.title}`); continue; }
    const p = parse(x.text);
    if (hitlSteps(p.desc).length || /^user\b/i.test(x.issue.blockedOn || '')) { owner++; addTitle('owner', `#${x.issue.id} ${x.issue.title}`); }
  }
  // Issues of the Projects that wait for the owner: open, trusted, label needs-owner (as on projects.html).
  for (const [pn, p] of Object.entries((await projectsIssues()).projects)) {
    for (const i of p.issues) if (i.state === 'open' && i.trusted && i.labels.includes('needs-owner')) { owner++; addTitle('owner', `${i.id} ${i.title}`); }
  }
  // Green PRs of the Projects that the server does not merge (touch .github/, dependencies, deploy): the owner merges them (issue 349).
  const prsSrc = (await readSource(PRS_TO_MERGE)).j?.prs;
  const prs = (Array.isArray(prsSrc) ? prsSrc : []).filter(x => x && /^[a-z0-9][a-z0-9-]{0,40}$/.test(x.project) && Number.isInteger(x.pr))
    .map(x => ({ project: wclean(x.project, 30), pr: x.pr, url: /^https:\/\/github\.com\//.test(x.url) ? String(x.url).slice(0, 300) : '', title: wclean(x.title, 100), reason: wclean(x.reason, 200), since: Number.isFinite(x.since) ? x.since : 0 }));
  for (const x of prs) { owner++; addTitle('owner', `${x.project}#${x.pr} da unire a mano`); }
  const releases = Object.entries(rel.j?.projects || {}).filter(([, p]) => p && ['serve-owner', 'announced'].includes(p.status)).map(([n, p]) => ({ project: wclean(n, 30), status: p.status }));
  for (const r of releases) addTitle('rel', `${r.project}: ${r.status === 'serve-owner' ? 'la unisci tu' : 'annunciato'}`);
  const up = new Set(Array.isArray(health.j?.up) ? health.j.up : []);
  const optional = new Set(Array.isArray(health.j?.optional) ? health.j.optional : []);
  // Probe names as in dashboard-stats; an optional service counts only when enabled. No health data = unknown, not down.
  const down = health.j ? WATCH_PROBES.filter(n => !up.has(n) && (n !== 'Notifiche (ntfy)' || optional.has('ntfy'))) : [];
  for (const d of down) addTitle('down', d);
  const titles = [...tt.down, ...tt.rel, ...tt.owner, ...tt.prop].slice(0, 3);
  const cats = jobs.j?.categories || {};
  const brainJobs = (cats.second_brain?.jobs || []);
  const brainBad = brainJobs.filter(j => j.status === 'error' || j.status === 'late').length;
  const brainLast = brainJobs.reduce((m, j) => Math.max(m, Number.isFinite(j.t) ? j.t : 0), 0);
  const a = auto.j || {};
  const items = { down: tt.down.slice(0, WATCH_ITEMS_MAX), releases: tt.rel.slice(0, WATCH_ITEMS_MAX), owner: tt.owner.slice(0, WATCH_ITEMS_MAX), proposals: tt.prop.slice(0, WATCH_ITEMS_MAX) };
  const needs = { proposals, owner, releases: releases.length, down: down.length, titles, items, prs };
  // Projects: open issues, those waiting for the owner, what is installed and when (project-cd.json). Names and counts only.
  const cd = (await readSource(WATCH_PROJECT_CD)).j || {};
  const projects = Object.entries((await projectsIssues()).projects).map(([name, p]) => {
    const open = p.issues.filter(i => i.state === 'open');
    const at = Date.parse((cd[name] || {}).at || '');
    return { name: wclean(name, 20), open: open.length, owner: open.filter(i => i.trusted && i.labels.includes('needs-owner')).length,
      installed: Number.isFinite(at) ? Math.floor(at / 1000) : 0, paused: !!(cd[name] || {}).paused, stale: p.stale || !!p.error };
  });
  // Scheduled jobs: how many, and the ones that are not ok (title and status), worst first.
  const allJobs = Object.values(cats).flatMap(c => c.jobs || []);
  const badJobs = allJobs.filter(j => j.status === 'error' || j.status === 'late').sort((x, y) => (x.status === 'error' ? 0 : 1) - (y.status === 'error' ? 0 : 1));
  const jobsSummary = { total: allJobs.length, bad: badJobs.length, list: badJobs.slice(0, WATCH_ITEMS_MAX).map(j => wclean(`${j.title}: ${j.status}`, 80)) };
  const stale = Object.entries(fresh).filter(([, v]) => v.stale).map(([k]) => k);
  const attention = proposals + owner + releases.length + down.length;
  return {
    generated: nowS,
    needs,
    system: {
      auto: { state: wclean(a.code, 20), now: a.current ? wclean(`#${a.current.id}`, 20) : '', queue: Number.isFinite(a.queueTotal) ? a.queueTotal : (Array.isArray(a.queue) ? a.queue.length : 0),
        paused: !!a.gates?.paused, next: Number.isFinite(a.nextSlot) ? a.nextSlot : 0,
        queueItems: (Array.isArray(a.queue) ? a.queue : []).slice(0, WATCH_ITEMS_MAX).map(q => wclean(`#${q.id} ${q.title}`, WATCH_TITLE_MAX)),
        quota: { week: Number.isFinite(a.gates?.week?.util) ? a.gates.week.util : null, five: Number.isFinite(a.gates?.five?.util) ? a.gates.five.util : null } },
      brain: { ok: brainBad === 0, last: brainLast },
    },
    projects,
    jobs: jobsSummary,
    server: { battery: Number.isFinite(status.j?.level) ? status.j.level : null, temp: Number.isFinite(status.j?.battery_temp) ? status.j.battery_temp : null,
      charging: wclean(status.j?.status, 20) },
    fresh,
    stale,
    ok: stale.length === 0 && attention === 0 && brainBad === 0 && !a.gates?.paused,
  };
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
  if (p === '/api/watch' && req.method === 'GET') {
    if (!watchAuthed(req)) { await new Promise(r => setTimeout(r, 1000)); return send(res, 401, { error: 'token' }); }
    return send(res, 200, await watchSummary(), { 'Cache-Control': 'no-store' });
  }
  // "Avvia ora" from the watch (issue 292): the same manual run as the owner's button (same limits: not while working, a request pending, 6 an hour).
  if (p === '/api/watch/run' && req.method === 'POST') {
    if (!watchAuthed(req)) { await new Promise(r => setTimeout(r, 1000)); return send(res, 401, { error: 'token' }); }
    return send(res, 202, await autoRun({}), { 'Cache-Control': 'no-store' });
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
    return send(res, 200, { ...me, originUrl, children, links, problems, desc: parsed.desc, hitl: hitlSteps(parsed.desc), commentList: parsed.comments, history: await history(cur.issue.file) });
  }
  if (m && req.method === 'PATCH') return send(res, 200, await updateIssue(m[1], await readJson(req)));
  if (p === '/api/projects-issues' && req.method === 'GET') return send(res, 200, await projectsIssues());
  if (p === '/api/projects-issues/write' && req.method === 'POST') return send(res, 202, await projectsWrite(await readJson(req)));
  const pw = /^\/api\/projects-issues\/write\/([a-f0-9]{16})$/.exec(p);
  if (pw && req.method === 'GET') return send(res, 200, await projectsWriteResult(pw[1]));
  if (p === '/api/questions' && req.method === 'GET') return send(res, 200, await questions());
  if (p === '/api/questions/snooze' && req.method === 'POST') return send(res, 200, await snoozeQuestion(await readJson(req)));
  if (p === '/api/releases' && req.method === 'GET') return send(res, 200, await releases());
  if (p === '/api/prs-to-merge' && req.method === 'GET') return send(res, 200, await prsToMerge());
  if (p === '/api/releases/postpone' && req.method === 'POST') return send(res, 200, await releasePostpone(await readJson(req)));
  if (p === '/api/recent' && req.method === 'GET') return send(res, 200, await recent());
  if (p === '/api/jobs' && req.method === 'GET') return send(res, 200, await jobsStatus());
  if (p === '/api/phone-apps' && req.method === 'GET') return send(res, 200, await phoneApps());
  const pa = /^\/api\/phone-apps\/([a-z0-9-]{1,30})$/.exec(p);
  if (pa && req.method === 'POST') return send(res, 200, await markPhoneApp(pa[1], await readJson(req)));
  if (p === '/api/mail' && req.method === 'GET') return send(res, 200, await mailStatus());
  if (p === '/api/mail/url' && req.method === 'PUT') return send(res, 200, await setMailUrl(await readJson(req)));
  if (p === '/api/mail/test' && req.method === 'POST') return send(res, 202, await mailTest());
  if (p === '/api/auto' && req.method === 'GET') return send(res, 200, await autoStatus());
  if (p === '/api/auto/log' && req.method === 'GET') return send(res, 200, await autoLog());
  if (p === '/api/suggest/log' && req.method === 'GET') return send(res, 200, await suggestLog());
  if (p === '/api/auto/usage' && req.method === 'GET') return send(res, 200, await autoUsage());
  if (p === '/api/auto/signals' && req.method === 'GET') return send(res, 200, await autoSignals());
  if (p === '/api/auto/run' && req.method === 'POST') return send(res, 202, await autoRun(await readJson(req)));
  if (p === '/api/queue-config' && req.method === 'GET') return send(res, 200, await getQueueConfig());
  if (p === '/api/queue-config' && req.method === 'PUT') return send(res, 200, await saveQueueConfig(await readJson(req), false));
  if (p === '/api/queue-config/preview' && req.method === 'POST') return send(res, 200, await saveQueueConfig(await readJson(req), true));
  if (p === '/api/apps' && req.method === 'GET') return send(res, 200, await appsStatus());
  if (p === '/api/apps' && req.method === 'POST') return send(res, 202, await appsAction(await readJson(req)));
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
