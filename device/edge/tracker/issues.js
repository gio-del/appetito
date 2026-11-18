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

// Issue numbers from the file names of open/, done/ and proposed/ (names only: proposals are never read).
function fileIds(repo) {
  const out = [];
  for (const state of ['open', 'done', 'proposed']) {
    let names = [];
    try { names = fs.readdirSync(path.join(repo, 'issues', state)); } catch { continue; }
    for (const file of names) { const m = FILE_RE.exec(file); if (m) out.push({ id: m[1], state, file }); }
  }
  return out;
}
// Next free number (issue 087): above every file, pending proposals included, so a hand-written issue
// can't take the number of a proposal it can't see. Tracker, hs-monitor and `issues-next-id` share it.
const nextId = repo => String(Math.max(0, ...fileIds(repo).map(f => parseInt(f.id, 10))) + 1).padStart(3, '0');

function addComment(p, author, text) {
  const t = now();
  p.comments.push({ date: `${t.date} ${t.time}`, author, text });
}

// Mechanical shape fixes (issue 114): the lint findings with exactly one correct fix, applied by housekeep
// instead of opening a `monitor, lint` issue for ops-auto. Judgement ones (duplicates, hidden work, epics,
// id clashes, a two-level Parent, an unknown Status word) stay lint findings.
// - Status missing -> `todo` if the issue has an unticked "- [ ]" step (work ready), else `backlog`;
//   a known spelling (`Todo`, `in progress`, `doing`, …) -> its canonical value;
// - `Blocked on: issue NNN` naming numbers no file has -> those dropped (`-` if none is left);
// - `Parent:` naming no existing issue -> field removed.
// Returns { fields: [[key, value|null]], notes: [Italian comment lines] }, empty when nothing to fix.
const STATUS_VALUES = ['backlog', 'todo', 'in-progress'];
const STATUS_ALIAS = { 'to do': 'todo', 'to-do': 'todo', 'in progress': 'in-progress', 'in_progress': 'in-progress',
  'inprogress': 'in-progress', 'doing': 'in-progress', 'wip': 'in-progress' };
function shapeFixes(p, ids) {
  const fields = [], notes = [];
  const raw = (getField(p, 'Status') || '').trim();
  const low = raw.toLowerCase().replace(/\s+/g, ' ');
  if (!raw) {
    const st = UNTICKED_RE.test(p.desc) ? 'todo' : 'backlog';
    fields.push(['Status', st]);
    notes.push(`Status mancante: messo \`${st}\` (${st === 'todo' ? 'ha passi da fare' : 'nessun passo da fare'}); cambialo se non va.`);
  } else if (raw !== low || STATUS_ALIAS[low]) {
    const st = STATUS_VALUES.includes(low) ? low : STATUS_ALIAS[low];
    if (st && st !== raw) { fields.push(['Status', st]); notes.push(`Status «${raw}» scritto come \`${st}\`.`); }
  }
  const bl = blockers((getField(p, 'Blocked on') || '').trim());
  const missing = (bl || []).filter(k => !ids.has(k));
  if (missing.length) {
    const rest = bl.filter(k => ids.has(k));
    fields.push(['Blocked on', rest.length ? `issue ${rest.join(', ')}` : '-']);
    notes.push(`Blocked on: tolte le issue inesistenti ${missing.join(', ')}${rest.length ? '' : ' (nessun blocco rimasto)'}.`);
  }
  const par = (getField(p, 'Parent') || '').trim();
  if (getField(p, 'Parent') !== undefined && (!/^\d{3,}$/.test(par) || !ids.has(par))) {
    fields.push(['Parent', null]);
    notes.push(`Parent «${par}» tolto: la issue non esiste.`);
  }
  return { fields, notes };
}

// Deterministic, idempotent rules (no Claude):
// 0. the mechanical shape fixes above (issue 114), with a comment saying what changed;
// 1. an open issue labelled "epic", Blocked on "-", no unticked "- [ ]" step, with >=1 child and every
//    child in done/ -> moved to done/ with Closed + a comment;
// 2. an open issue "Blocked on: issue NNN[, MMM]" whose blockers are all in done/ -> "Blocked on: -" + a comment.
// Returns the actions taken, one line each.
function housekeep(repo, author = 'sistema') {
  const log = [];
  for (let round = 0; round < 10; round++) {
    const all = readAll(repo);
    const done = new Set(all.filter(i => i.state === 'done').map(i => i.id));
    const known = new Set(fileIds(repo).map(f => f.id));
    let changed = false;
    for (const i of all.filter(x => x.state === 'open')) {
      const fix = shapeFixes(i.p, known);
      if (fix.fields.length) {
        for (const [k, v] of fix.fields) setField(i.p, k, v);
        addComment(i.p, author, `Forma corretta in automatico: ${fix.notes.join(' ')}`);
        writeAtomic(i.full, serialize(i.p));
        log.push(`fixed shape of ${i.id} (${fix.fields.map(([k]) => k).join(', ')})`);
        changed = true;
        continue;
      }
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
      // 2b. hidden work (issue 616): `Blocked on: user` with non-HITL `- [ ]` steps (epics have their own rule):
      // those lines move to a new todo issue blocked on this one, so ops-auto sees them without a lint round trip.
      if (!labels.includes('epic') && /^user\b/i.test(blocked)) {
        const lines = i.p.desc.split('\n');
        const moved = lines.filter(l => UNTICKED_LINE_RE.test(l) && !/\(HITL\)/.test(l));
        if (moved.length) {
          const par = (getField(i.p, 'Parent') || '').trim();
          const body = `Passi autonomi spostati dalla issue ${i.id} (aspetta l'owner): li fa ops-auto, la ${i.id} resta ferma sul suo passo (HITL).\n\n## Esecuzione\n${moved.join('\n')}\n`;
          const { file } = newIssue(repo, `${i.p.title.replace(/^Issue \d+:\s*/, '')}: passi autonomi`.slice(0, 120),
            { status: 'todo', blockedOn: `issue ${i.id}`, related: i.id, body, parent: par && known.has(par) ? par : undefined });
          const nid = FILE_RE.exec(path.basename(file))[1];
          i.p.desc = lines.filter(l => !moved.includes(l)).join('\n');
          addComment(i.p, author, `Passi non HITL spostati nella issue ${nid} (Blocked on: issue ${i.id}): ${moved.length} ${moved.length > 1 ? 'passi' : 'passo'}, così ops-auto li vede.`);
          writeAtomic(i.full, serialize(i.p));
          log.push(`split hidden work of ${i.id} into ${nid}`);
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
    // 3. similar but below the duplicate tier -> Related on the lower number, with a comment (issue 262)
    const open = new Map(all.filter(x => x.state === 'open').map(x => [x.id, x]));
    for (const [a, b, sc] of duplicatePairs(all)) {
      if (sc >= DUPLICATE_MIN) continue;
      const i = open.get(a);
      if (!i) continue;
      const rel = idList(getField(i.p, 'Related'));
      setField(i.p, 'Related', [...rel, b].join(', '));
      addComment(i.p, author, `Collegata a ${b} con Related: testo simile (${sc}) ma lavoro diverso, non un duplicato.`);
      writeAtomic(i.full, serialize(i.p));
      log.push(`related ${a} -> ${b}`);
      changed = true;
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
const DUPLICATE_MIN = 0.6; // issue 262: from here a pair is a judgement call; between SIMILAR_MIN and this, housekeep links it with Related
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
  const parentOf = new Map(all.map(i => [i.id, (getField(i.p, 'Parent') || '').trim()]));
  const out = [];
  const eligible = all.map((i, k) => [i, k]).filter(([i]) => {
    if (i.state !== 'open') return false;
    const labels = (getField(i.p, 'Labels') || '').split(',').map(s => s.trim().toLowerCase());
    return !labels.includes('monitor') && !labels.includes('epic');
  });
  for (let a = 0; a < eligible.length; a++) for (let b = a + 1; b < eligible.length; b++) {
    const [x, i] = eligible[a], [y, j] = eligible[b];
    if (links.has(`${x.id}-${y.id}`)) continue;
    if (parentOf.get(x.id) && parentOf.get(x.id) === parentOf.get(y.id)) continue; // siblings: planned together by their epic (issue 356)
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
// hs-monitor), msg (Italian), auto (true: housekeep fixes it by itself, issue 114; hs-monitor opens no issue) }.
function lint(repo, nowMs = Date.now()) {
  const all = readAll(repo).filter(i => i.state !== 'proposed');
  const ids = new Set(all.map(i => i.id));
  for (const f of fileIds(repo)) ids.add(f.id);
  const parentOf = new Map(all.map(i => [i.id, (getField(i.p, 'Parent') || '').trim()]));
  const out = [];
  const add = (i, rule, msg, auto = false) => out.push({ id: i.id, ids: [i.id], rule, fp: `lint-${rule}-${i.id}`, msg, auto });
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
    const fixed = new Set(shapeFixes(i.p, ids).fields.map(([k]) => k));
    const status = (getField(i.p, 'Status') || '').trim().toLowerCase();
    if (!status) add(i, 'no-status', `Issue ${i.id} senza Status`, true);
    else if (!STATUSES.includes(status) || fixed.has('Status')) add(i, 'no-status', `Issue ${i.id}: Status «${status}» non valido (backlog, todo, in-progress)`, fixed.has('Status'));
    if (/^user\b/i.test(blocked) && unticked.some(l => !/\(HITL\)/.test(l)))
      add(i, 'hidden-work', `Issue ${i.id}: passi automatizzabili dietro un blocco dell'owner`);
    const bl = blockers(blocked);
    const missing = (bl || []).filter(k => !ids.has(k));
    if (missing.length) add(i, 'blocker-missing', `Issue ${i.id}: Blocked on nomina issue inesistenti (${missing.join(', ')})`, true);
    const nb = getField(i.p, 'Not before');
    if (nb !== undefined && !notBeforeOf(i.p)) add(i, 'not-before-bad', `Issue ${i.id}: Not before «${nb.trim()}» non è una data valida (YYYY-MM-DD)`);
    const oc = getField(i.p, 'Owner-confirmed');
    if (oc !== undefined && !validDay(oc.trim())) add(i, 'owner-confirmed-bad', `Issue ${i.id}: Owner-confirmed «${oc.trim()}» non è una data valida (YYYY-MM-DD)`);
    const chk = getField(i.p, 'Check');
    if (chk !== undefined && !checkValid(chk)) add(i, 'check-bad', `Issue ${i.id}: Check «${chk.trim().slice(0, 60)}» non è valido (deb-version PKG >= X, release OWNER/REPO >= X, url-status URL, url-contains URL TOKEN, file-exists /PATH)`);
    const par = parentOf.get(i.id);
    if (par) {
      if (!/^\d{3,}$/.test(par) || !ids.has(par)) add(i, 'parent-bad', `Issue ${i.id}: Parent ${par} non esiste`, true);
      else if (par === i.id || parentOf.get(par)) add(i, 'parent-bad', `Issue ${i.id}: Parent ${par} è a sua volta una sotto-issue (un solo livello)`);
    }
  }
  // Two files with the same number (issue 087): relations and links become ambiguous.
  const byId = new Map();
  for (const f of fileIds(repo)) { const k = String(parseInt(f.id, 10)).padStart(3, '0'); byId.set(k, [...(byId.get(k) || []), f]); }
  for (const [id, fl] of byId) if (fl.length > 1) out.push({ id, ids: [id], rule: 'id-clash', fp: `lint-id-clash-${id}`, auto: false,
    msg: `Numero ${id} usato da ${fl.length} issue (${fl.map(f => `${f.state}/${f.file}`).join(', ')}): rinumera quella scritta a mano` });
  // Possible duplicates (issue 058): one finding per pair, gone once one closes or they get `Related:`.
  // Two tiers (issue 262): near-identical text is a judgement call; anything less similar is just related work
  // and housekeep links it with Related by itself (auto: hs-monitor opens no issue).
  for (const [a, b, sc] of duplicatePairs(all)) {
    if (sc >= DUPLICATE_MIN) out.push({ id: a, ids: [a, b], rule: 'possible-duplicate', fp: `lint-possible-duplicate-${a}-${b}`, auto: false,
      msg: `Issue ${a} e ${b}: possibile duplicato (unisci con Duplicate of, o collega con Related se sono lavori diversi)` });
    else out.push({ id: a, ids: [a, b], rule: 'related-auto', fp: `lint-related-auto-${a}-${b}`, auto: true,
      msg: `Issue ${a} e ${b}: simili ma non duplicati, collegate con Related` });
  }
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

// What ops-auto may pick (issue 099): one selector for the worker (`--queue`, called by `ops-auto`),
// the tracker's "Lavora su questa issue" check and the queue on /auto.html, so they can't drift.
// Open, not blocked, not an epic, not waiting for its `Not before:` date (issue 145), and either a
// monitor issue or Status todo/in-progress.
const PRIO_RANK = { urgent: 0, high: 1, medium: 2, low: 4 };
const labelsOf = p => (getField(p, 'Labels') || '').split(',').map(s => s.trim()).filter(Boolean);
// `Check: KIND ARGS` (issue 354): same grammar as questions-recheck, which runs it.
function checkValid(v) {
  const w = String(v).trim().split(/\s+/);
  const ver = /^[A-Za-z0-9.+:~-]+$/;
  switch (w[0]) {
    case 'deb-version': return w.length === 4 && /^[a-z0-9][a-z0-9.+-]*$/.test(w[1]) && w[2] === '>=' && ver.test(w[3]);
    case 'release': return w.length === 4 && /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(w[1]) && w[2] === '>=' && /^v?[0-9][A-Za-z0-9.+~-]*$/.test(w[3]);
    case 'url-status': return w.length === 2 && /^https?:\/\/[A-Za-z0-9._~:\/?&=%+#@-]{1,300}$/.test(w[1]);
    case 'url-contains': return w.length === 3 && /^https:\/\/[A-Za-z0-9._~:\/?&=%+#@-]{1,300}$/.test(w[1]) && /^[A-Za-z0-9._+-]{1,60}$/.test(w[2]);
    case 'file-exists': return w.length === 2 && /^\/[A-Za-z0-9._\/+-]{1,200}$/.test(w[1]);
    default: return false;
  }
}
// `YYYY-MM-DD` that is a real calendar date (Owner-confirmed, issue 478).
function validDay(v) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v || '');
  if (!m) return false;
  const d = new Date(+m[1], m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === m[2] - 1 && d.getDate() === +m[3];
}
// `Not before: YYYY-MM-DD` -> the date if it is a real calendar date, else null (lint flags it).
function notBeforeOf(p) {
  const v = (getField(p, 'Not before') || '').trim();
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(v);
  if (!m) return null;
  const d = new Date(+m[1], m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === m[2] - 1 && d.getDate() === +m[3] ? v : null;
}
const localDate = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// The `Not before:` date while the local date is still earlier, else '' (an invalid date never holds an issue back).
function waitingUntil(p, nowMs = Date.now()) {
  const nb = notBeforeOf(p);
  return nb && localDate(nowMs) < nb ? nb : '';
}
function pickable(state, p, nowMs = Date.now()) {
  if (state !== 'open' || !/^-/.test((getField(p, 'Blocked on') || '-').trim())) return false;
  if (waitingUntil(p, nowMs)) return false;
  const labels = labelsOf(p);
  return !labels.includes('epic') && (labels.includes('monitor') || ['todo', 'in-progress'].includes((getField(p, 'Status') || '').trim().toLowerCase()));
}
// Best first: monitor issues, then the rest; within each by Priority (urgent, high, medium, none, low); then file name.
function queueOf(items, nowMs = Date.now()) {
  const key = i => (labelsOf(i.p).includes('monitor') ? 0 : 1) * 10 + (PRIO_RANK[(getField(i.p, 'Priority') || '').trim().toLowerCase()] ?? 3);
  return items.filter(i => pickable(i.state, i.p, nowMs)).sort((a, b) => key(a) - key(b) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}
const queue = (repo, nowMs = Date.now()) => queueOf(readAll(repo, ['open']), nowMs);
// Trusted open issues of the other Projects (issue 186), after home-server's own queue: from the mirror
// projects-issues.json (issue 091), only trust author/self-assigned (160), a Project not stale, no
// blocked/epic/needs-owner label (the last one: ops-auto handed it to the owner, issue 188). Id `sumisura#221` becomes `sumisura-221` (file names). Projects in the order of
// the first column of the projects list, issues by ascending number.
function projectQueue(mirrorFile, projectsFile, nociDir = process.env.HS_NOCI_DIR || '', waits = null) {
  let mirror, names = [];
  try { mirror = JSON.parse(fs.readFileSync(mirrorFile, 'utf8')); } catch { return []; }
  try {
    names = fs.readFileSync(projectsFile, 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'))
      .map(l => l.split('|')[0].trim()).filter(n => n && n !== 'home-server');
  } catch { return []; }
  const out = [];
  for (const n of names) {
    const pr = (mirror.projects || {})[n];
    if (!pr || pr.stale) continue;
    // a Project without any CI (file in nociDir, written by projects-ci-watch, issue 232): only its `ci` issue is worked, and that one goes first
    let noci = false;
    try { noci = !!nociDir && fs.existsSync(path.join(nociDir, n)); } catch {}
    const isCi = i => (i.labels || []).includes('ci');
    for (const i of [...(pr.issues || [])].sort((a, b) => (isCi(b) - isCi(a)) || a.number - b.number)) {
      if (i.state !== 'open' || !['author', 'self-assigned'].includes(i.trust)) continue;
      if ((i.labels || []).some(l => ['blocked', 'epic', 'needs-owner'].includes(l))) continue;
      if (noci && !isCi(i)) { if (waits) waits[`${n}-${i.number}`] = { why: 'ci' }; continue; }
      out.push(`${n}-${i.number}`);
    }
  }
  return out;
}

// Entries of the Project queue that wait (issue 259), one rule for ops-auto (`--waiting`, its selector) and the card/tracker:
// an open PR of ours (stDir/pr/ID, content = its url, younger than prDays), a hold after "aspetta te" (stDir/hold/ID, < 90 min),
// a Project without any CI (stDir/noci/NAME, only its `ci` issue is queued). Returns {id: {why: 'pr'|'hold'|'ci', pr?: url}}.
function queueWaits(mirrorFile, projectsFile, stDir, prDays = 7, nowMs = Date.now()) {
  const waits = {}, ids = projectQueue(mirrorFile, projectsFile, path.join(stDir, 'noci'), waits);
  const young = (f, ms) => { try { return nowMs - fs.statSync(f).mtimeMs < ms; } catch { return false; } };
  for (const id of ids) {
    const pf = path.join(stDir, 'pr', id);
    if (young(pf, prDays * 864e5)) { let u = ''; try { u = fs.readFileSync(pf, 'utf8').trim(); } catch {} waits[id] = { why: 'pr', pr: u }; }
    else if (young(path.join(stDir, 'hold', id), 90 * 6e4)) waits[id] = { why: 'hold' };
  }
  return waits;
}

// ---------- queue strategy (issue 225) ----------
// One place decides the order of ops-auto's queue: ops-auto (`--order`), the card and the tracker's
// preview on /queue.html all call orderQueue. Config (JSON, written by the tracker, default = rotation):
// { strategy: rotation|weighted|priority|focus, urgent_first: bool, focus: SOURCE|'', sources: { NAME: { weight: 1-5, paused: bool } } }.
const STRATEGIES = ['rotation', 'weighted', 'priority', 'focus'];
const DEFAULT_QCONFIG = { strategy: 'rotation', urgent_first: false, focus: '', sources: {} };
const srcOf = id => /\.md$/.test(id) ? 'home-server' : id.replace(/-\d+$/, '');
function validateQueueConfig(c, sources) {
  const bad = m => Object.assign(new Error(m), { status: 400 });
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw bad('configurazione mancante');
  if (!STRATEGIES.includes(c.strategy)) throw bad('strategia sconosciuta');
  if (typeof c.urgent_first !== 'boolean') throw bad('urgent_first non valido');
  const focus = c.focus || '';
  if (focus && !sources.includes(focus)) throw bad('progetto in evidenza sconosciuto');
  if (c.strategy === 'focus' && !focus) throw bad('scegli il progetto da mettere in evidenza');
  if (!c.sources || typeof c.sources !== 'object' || Array.isArray(c.sources)) throw bad('sources non valido');
  const out = {};
  for (const [k, v] of Object.entries(c.sources)) {
    if (!sources.includes(k)) throw bad(`fonte sconosciuta: ${k}`);
    if (!v || typeof v !== 'object' || !Number.isInteger(v.weight) || v.weight < 1 || v.weight > 5) throw bad(`${k}: peso da 1 a 5`);
    if (typeof v.paused !== 'boolean') throw bad(`${k}: pausa non valida`);
    out[k] = { weight: v.weight, paused: v.paused };
  }
  return { strategy: c.strategy, urgent_first: c.urgent_first, focus, sources: out };
}
// A missing, unreadable or invalid file is the default (today's rotation). `sources` = names allowed (null: not checked).
function loadQueueConfig(file, sources = null) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    return validateQueueConfig(c, sources || [...Object.keys(c.sources || {}), c.focus || ''].filter(Boolean));
  } catch { return { ...DEFAULT_QCONFIG, sources: {} }; }
}
// entries: [{id, h}] in the selector's order (h = stays in front: red CI, monitor); last = {src, used} (ops-auto's $ST/rr:
// the source of the last pick and how many picks in a row); prio(id) -> urgent|high|medium|low|'' .
function orderQueue(entries, cfg = DEFAULT_QCONFIG, last = {}, prio = () => '') {
  const front = entries.filter(e => e.h).map(e => e.id);
  const srcCfg = s => (cfg.sources || {})[s] || {};
  const order = [], items = {};
  for (const e of entries) {
    const s = srcOf(e.id);
    if (e.h || srcCfg(s).paused) continue;
    if (!items[s]) { items[s] = []; order.push(s); }
    items[s].push(e.id);
  }
  const w = s => cfg.strategy === 'weighted' ? (srcCfg(s).weight || 1) : 1;
  // Rotation over the sources of `names`, starting after the last one picked; a source keeps the turn for its weight picks.
  const rotate = names => {
    const p = {}, seq = [];
    let cur = names.includes(last.src) ? last.src : null, used = cur ? Math.max(last.used || 1, 1) : 0;
    for (let left = names.reduce((a, s) => a + items[s].length, 0); left > 0; left--) {
      if (!(cur && (p[cur] || 0) < items[cur].length && used < w(cur))) {
        const i = cur ? names.indexOf(cur) : -1;
        for (let k = 1; k <= names.length; k++) { const s = names[(i + k) % names.length]; if ((p[s] || 0) < items[s].length) { cur = s; break; } }
        used = 0;
      }
      p[cur] = (p[cur] || 0) + 1; seq.push(items[cur][p[cur] - 1]); used++;
    }
    return seq;
  };
  let seq;
  if (cfg.strategy === 'focus' && items[cfg.focus]) seq = [...items[cfg.focus], ...rotate(order.filter(s => s !== cfg.focus))];
  else seq = rotate(order);
  if (cfg.strategy === 'priority') {
    const rank = id => ({ urgent: 0, high: 1, medium: 2, low: 4 })[prio(id)] ?? 3;
    seq = seq.map((id, i) => [id, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
  }
  if (cfg.urgent_first) seq = [...seq.filter(id => prio(id) === 'urgent'), ...seq.filter(id => prio(id) !== 'urgent')];
  return [...front, ...seq];
}
// Priority of a queue entry: Priority field of a local issue, label priority:X of a Project issue (issue 225).
function prioReader(repo, mirrorFile) {
  let mirror = {};
  try { mirror = JSON.parse(fs.readFileSync(mirrorFile, 'utf8')); } catch {}
  return id => {
    if (/\.md$/.test(id)) {
      try { return (getField(parse(fs.readFileSync(path.join(repo, 'issues', 'open', id), 'utf8')), 'Priority') || '').trim().toLowerCase().split(/\s+/)[0]; } catch { return ''; }
    }
    const m = /^(.*)-(\d+)$/.exec(id);
    const it = m && (((mirror.projects || {})[m[1]] || {}).issues || []).find(i => String(i.number) === m[2]);
    for (const l of (it && it.labels) || []) { const x = /^priority:(urgent|high|medium|low)$/.exec(l); if (x) return x[1]; }
    return '';
  };
}
// "h id" / "r id" lines -> entries; "src used" file -> last.
const parseEntries = text => text.split('\n').map(l => /^([hr]) (\S+)$/.exec(l)).filter(Boolean).map(m => ({ h: m[1] === 'h', id: m[2] }));
const parseLast = text => { const [src, n] = (text || '').trim().split(/\s+/); return { src: src || '', used: Number(n) || 1 }; };

// ---------- new issue (issue 114) ----------
// `issues-new TITLE [--parent N] [--status S] [--labels a,b] [--blocked-on X] [--related N,M]`: writes
// issues/open/NNN-slug.md with the full header (number from nextId, Opened today, Status default todo,
// Blocked on default "-"), so a hand-written issue starts in the right shape. Returns { file, similar }.
function slugify(title) {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'issue';
}
function newIssue(repo, title, o = {}) {
  title = (title || '').trim();
  if (!title || /[\r\n]/.test(title)) throw new Error('titolo mancante');
  const status = (o.status || 'todo').trim().toLowerCase();
  if (!STATUS_VALUES.includes(status)) throw new Error(`Status «${o.status}» non valido (${STATUS_VALUES.join(', ')})`);
  const ids = new Set(fileIds(repo).map(f => f.id));
  const blocked = (o.blockedOn || '-').trim();
  if (/[\r\n]/.test(blocked)) throw new Error('Blocked on non valido');
  for (const k of blockers(blocked) || []) if (!ids.has(k)) throw new Error(`Blocked on: la issue ${k} non esiste`);
  const p = { title, fields: [], desc: (o.body || '').trim(), comments: [] };
  setField(p, 'Opened', now().date);
  setField(p, 'Blocked on', blocked);
  setField(p, 'Status', status);
  if (o.parent) {
    if (!/^\d{3,}$/.test(o.parent) || !ids.has(o.parent)) throw new Error(`Parent: la issue ${o.parent} non esiste`);
    setField(p, 'Parent', o.parent);
  }
  if (o.ownerConfirmed) setField(p, 'Owner-confirmed', now().date);
  if (o.labels) setField(p, 'Labels', o.labels.split(',').map(x => x.trim().toLowerCase()).filter(Boolean).join(', '));
  if (o.related) {
    const rel = idList(o.related);
    for (const k of rel) if (!ids.has(k)) throw new Error(`Related: la issue ${k} non esiste`);
    if (rel.length) setField(p, 'Related', rel.join(', '));
  }
  const sim = similar(corpus(repo, false), title, p.desc);
  const id = nextId(repo);
  const file = path.join(repo, 'issues', 'open', `${id}-${slugify(title)}.md`);
  fs.writeFileSync(file, serialize(p), { flag: 'wx', mode: 0o664 });
  return { file, similar: sim };
}
// Issue triage (issue 478). Candidates for "does it serve DIREZIONE.md": open issues in To do, not marked
// Owner-confirmed (nor any ancestor via Parent), not monitor, not a security advisory.
function triageCandidates(repo) {
  const all = readAll(repo, ['open']), by = new Map(all.map(i => [i.id, i]));
  const confirmed = i => {
    for (let n = 0, c = i; c && n < 5; n++, c = by.get((getField(c.p, 'Parent') || '').trim())) if (getField(c.p, 'Owner-confirmed') !== undefined) return true;
    return false;
  };
  return all.filter(i => (getField(i.p, 'Status') || '').trim().toLowerCase() === 'todo' && !confirmed(i)
    && !labelsOf(i.p).includes('monitor') && !/^advisory-/.test((getField(i.p, 'Fingerprint') || '').trim()));
}
// Moves a candidate to backlog with a (sistema) comment saying why. False if it is no longer a candidate.
function moveToBacklog(repo, id, reason) {
  const i = triageCandidates(repo).find(c => c.id === id);
  if (!i) return false;
  setField(i.p, 'Status', 'backlog');
  addComment(i.p, 'sistema', `Spostata in backlog: non serve alla direzione (DIREZIONE.md). ${reason} Riportala in To do dal tracker per riprenderla: da quel momento non viene più spostata.`);
  writeAtomic(i.full, serialize(i.p));
  return true;
}

module.exports = { triageCandidates, moveToBacklog, validDay, checkValid, STRATEGIES, DEFAULT_QCONFIG, validateQueueConfig, loadQueueConfig, orderQueue, prioReader, parseEntries, parseLast, srcOf, projectQueue, queueWaits, newIssue, pickable, waitingUntil, notBeforeOf, queueOf, queue, backlogAge, staleBacklog, parseGitDates, gitDates, GIT_DATES_ARGS, readAll, parse, serialize, getField, setField, now, FILE_RE, STATUS_VALUES, shapeFixes, COMMENTS_RE, housekeep, blockers, lint, idList, similar, corpus, nextId, similarity, duplicatePairs };

// CLI: `issues.js [REPO]` runs the housekeeping; `issues.js --lint [REPO]` prints the lint findings as JSON;
// `issues.js --next-id [REPO]` prints the next free issue number; `issues.js --queue [REPO]` prints the file
// names ops-auto would pick, best first (HS_QUEUE_NOW=YYYY-MM-DD, for tests, sets today);
// `issues.js --similar TITLE [BODY]` (REPO from $ISSUES_REPO) prints open/done issues similar to it, best
// first (proposals are left out: their text is untrusted and this runs in the ops session).
if (require.main === module && process.argv[2] === '--new') {
  const repo = process.env.ISSUES_REPO || path.join(process.env.HOME || '', 'home-server');
  const a = process.argv.slice(3), o = {};
  let title = '';
  const keys = { '--parent': 'parent', '--status': 'status', '--labels': 'labels', '--blocked-on': 'blockedOn', '--related': 'related', '--body': 'body' };
  for (let k = 0; k < a.length; k++) {
    if (a[k] === '--owner-confirmed') { o.ownerConfirmed = true; continue; }
    if (keys[a[k]]) { if (a[k + 1] === undefined) { console.error(`${a[k]}: valore mancante`); process.exit(2); } o[keys[a[k]]] = a[++k]; }
    else if (!title) title = a[k];
    else { console.error(`argomento inatteso: ${a[k]}`); process.exit(2); }
  }
  try {
    const r = newIssue(repo, title, o);
    console.log(r.file);
    if (r.similar.length) {
      console.error('Issue simili (aggiungi Related: o lavora lì se è lo stesso lavoro):');
      for (const c of r.similar) console.error(`${c.id}\t${c.score.toFixed(2)}\t${c.state}\t${c.title}`);
    }
  } catch (e) { console.error(`issues-new: ${e.message}`); process.exit(1); }
} else if (require.main === module && process.argv[2] === '--triage-candidates') {
  const repo = process.env.ISSUES_REPO || path.join(process.env.HOME || '', 'home-server');
  console.log(JSON.stringify(triageCandidates(repo).map(i => ({ n: i.id, title: i.p.title, labels: labelsOf(i.p).join(', '), parent: (getField(i.p, 'Parent') || '').trim(), text: (i.p.desc || '').slice(0, 700) }))));
} else if (require.main === module && process.argv[2] === '--to-backlog') {
  const repo = process.env.ISSUES_REPO || path.join(process.env.HOME || '', 'home-server');
  process.exit(moveToBacklog(repo, process.argv[3] || '', (process.argv[4] || '').replace(/\s+/g, ' ').trim()) ? 0 : 1);
} else if (require.main === module && process.argv[2] === '--similar') {
  const repo = process.env.ISSUES_REPO || path.join(process.env.HOME || '', 'home-server');
  for (const c of similar(corpus(repo, false), process.argv[3] || '', process.argv[4] || ''))
    console.log(`${c.id}\t${c.score.toFixed(2)}\t${c.state}\t${c.title}`);
} else if (require.main === module && process.argv[2] === '--queue') {
  const at = process.env.HS_QUEUE_NOW ? dayMs(process.env.HS_QUEUE_NOW) : Date.now();
  for (const i of queue(process.argv[3] || path.join(process.env.HOME || '', 'home-server'), at)) console.log(i.file);
  if (process.env.HS_QUEUE_PROJECTS_JSON)
    for (const id of projectQueue(process.env.HS_QUEUE_PROJECTS_JSON, process.env.HS_PROJECTS_FILE || '/etc/hs-projects')) console.log(id);
} else if (require.main === module && process.argv[2] === '--waiting') {
  // issue 259: `--waiting STATEDIR` prints the Project entries that wait, as JSON {id: {why, pr?}}
  console.log(JSON.stringify(queueWaits(process.env.HS_QUEUE_PROJECTS_JSON || '', process.env.HS_PROJECTS_FILE || '/etc/hs-projects', process.argv[3] || '', Number(process.env.HS_PR_WAIT_DAYS) || 7)));
} else if (require.main === module && process.argv[2] === '--order') {
  // issue 225: stdin "h id"/"r id" lines (selector order), config HS_QUEUE_CONFIG (or --config FILE), state HS_QUEUE_RR, no rr = start at the first source
  const repo = process.argv[3] || path.join(process.env.HOME || '', 'home-server');
  const cfgFile = process.argv[4] === '--config' ? process.argv[5] : process.env.HS_QUEUE_CONFIG || '/var/lib/hs-settings/queue.json';
  const rr = (() => { try { return fs.readFileSync(process.env.HS_QUEUE_RR || '', 'utf8'); } catch { return ''; } })();
  const entries = parseEntries(fs.readFileSync(0, 'utf8'));
  for (const id of orderQueue(entries, loadQueueConfig(cfgFile), parseLast(rr), prioReader(repo, process.env.HS_QUEUE_PROJECTS_JSON || ''))) console.log(id);
} else if (require.main === module && process.argv[2] === '--next-id') {
  console.log(nextId(process.argv[3] || path.join(process.env.HOME || '', 'home-server')));
} else if (require.main === module) {
  const lintMode = process.argv[2] === '--lint';
  const repo = process.argv[lintMode ? 3 : 2] || path.join(process.env.HOME || '', 'home-server');
  if (lintMode) console.log(JSON.stringify(lint(repo), null, 1));
  else for (const l of housekeep(repo)) console.log(l);
}
