'use strict';
// Prepared context for an ops-auto run (issue 118): from an issue it collects, deterministically, what the
// run would otherwise explore turn by turn: linked issues (Parent/Related/Blocked on: title, state, last
// progress section), the repo files it cites (lines, main functions of the big ones, last commits, tests
// that use them) and the docs/ sections that name them. Apps the issue names that have local docs (hs-docs-fetch,
// issue 125) get their path. An index, never file contents; capped at MAX bytes.
// Proposals are never read (untrusted text). CLI: `issues-context NNN [REPO]` (/usr/local/bin).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readAll, getField } = require('./issues.js');

const MAX = 8192;
const BIG = 150; // lines: above this, a file gets its function index
const PATH_RE = /(?:^|[\s`'"(])((?:device|docs|scripts|tailscale|\.claude)\/[A-Za-z0-9_./-]+)/g;
const BIN_RE = /(?:~\/bin|\/usr\/local\/s?bin|\/opt\/hs-tracker)\/([A-Za-z0-9_.-]+)/g;
const TICK_RE = /`([A-Za-z0-9_.-]+)(?:[ `])/g;

const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };

// Repo-relative paths of the files the text cites: explicit repo paths, installed paths mapped back to
// device/edge/debian or the tracker, and backticked names of scripts in device/edge/debian.
function citedFiles(repo, text) {
  const out = new Set();
  const add = rel => { rel = rel.replace(/[.,:;)]+$/, ''); if (isFile(path.join(repo, rel))) out.add(rel); };
  for (const m of text.matchAll(PATH_RE)) add(m[1]);
  for (const m of text.matchAll(BIN_RE)) { add(`device/edge/debian/${m[1]}`); add(`device/edge/tracker/${m[1]}`); }
  for (const m of text.matchAll(TICK_RE)) if (/[a-z]-?[a-z]/.test(m[1])) add(`device/edge/debian/${m[1]}`);
  return [...out];
}

// Top-level definitions of a shell/js file: "name@line".
function functions(text) {
  const out = [];
  text.split('\n').forEach((l, i) => {
    const m = /^(?:function\s+([A-Za-z0-9_$]+)|([A-Za-z0-9_]+)\s*\(\)\s*\{|(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-z]+)\s*=>)/.exec(l);
    if (m) out.push(`${m[1] || m[2] || m[3]}@${i + 1}`);
  });
  return out;
}

function git(repo, args) {
  try { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}

const lines = full => { try { return fs.readFileSync(full, 'utf8'); } catch { return ''; } };

// Last dated progress section of an issue: the last "## ... (date)"/"## ... YYYY-MM-DD" heading of the
// description or the last comment; heading plus its first 200 characters.
function lastProgress(p) {
  const c = p.comments[p.comments.length - 1];
  const secs = p.desc.split(/^(?=## )/m).filter(s => /^## .*\d{4}-\d\d-\d\d/.test(s));
  const s = secs[secs.length - 1];
  const sDate = s ? (/\d{4}-\d\d-\d\d/.exec(s) || [''])[0] : '';
  const pick = c && (!s || c.date.slice(0, 10) >= sDate) ? `${c.date} (${c.author}): ${c.text}` : s ? s.replace(/^## /, '') : '';
  const flat = pick.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? flat.slice(0, 200) + '…' : flat;
}

function context(repo, id, max = MAX, docsDir = process.env.HS_DOCS_DIR || '/usr/local/share/hs-docs') {
  const all = readAll(repo, ['open', 'done']);
  const me = all.find(i => i.id === id);
  if (!me) throw new Error(`issue ${id} non trovata in open/ o done/`);
  const text = [me.p.title, me.p.desc, ...me.p.comments.map(c => c.text)].join('\n');

  // Linked issues.
  const links = [];
  const ids = (v, re = /\d{3,}/g) => ((v || '').match(re) || []);
  for (const [k, v] of [['Parent', getField(me.p, 'Parent')], ['Related', getField(me.p, 'Related')], ['Blocked on', getField(me.p, 'Blocked on')]])
    for (const n of ids(v)) links.push([k, n.padStart(3, '0')]);
  for (const i of all) if (i.id !== id && ids(getField(i.p, 'Parent')).some(n => n.padStart(3, '0') === id)) links.push(['Child', i.id]);
  const seen = new Set();
  const linkLines = [];
  for (const [k, n] of links) {
    if (seen.has(n)) continue; seen.add(n);
    const i = all.find(x => x.id === n);
    if (!i) { linkLines.push(`- ${k} ${n}: non in open/ o done/`); continue; }
    const st = i.state === 'done' ? 'done' : (getField(i.p, 'Status') || '?');
    const lp = lastProgress(i.p);
    linkLines.push(`- ${k} ${n} [${st}] ${i.p.title} (issues/${i.state}/${i.file})${lp ? `\n  ultimo: ${lp}` : ''}`);
  }

  // Cited files.
  const files = citedFiles(repo, text);
  const tests = (() => { try { return fs.readdirSync(path.join(repo, 'device/edge/tests')); } catch { return []; } })();
  const docs = (() => { try { return fs.readdirSync(path.join(repo, 'docs')).filter(f => f.endsWith('.md')); } catch { return []; } })();
  const fileBlocks = [], fnLines = [];
  for (const f of files) {
    const t = lines(path.join(repo, f));
    const n = t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
    const base = path.basename(f);
    const usedBy = tests.filter(x => `device/edge/tests/${x}` !== f && lines(path.join(repo, 'device/edge/tests', x)).includes(base)).map(x => `device/edge/tests/${x}`);
    const log = git(repo, ['log', '--format=%h %s', '-3', '--', f]).split('\n').filter(Boolean).map(l => (l.length > 110 ? l.slice(0, 110) + '…' : l));
    fileBlocks.push(`- ${f} (${n} righe)${usedBy.length ? `\n  test: ${usedBy.join(', ')}` : ''}${log.length ? `\n  commit: ${log.join(' | ')}` : ''}`);
    if (n > BIG && !f.endsWith('.md')) { const fn = functions(t); if (fn.length) fnLines.push(`- ${f}: ${fn.join(' ')}`); }
  }

  // docs/ lines naming the cited files (as a path or in backticks), grouped by section. Dated docs
  // (planning notes, reviews, baselines) are history, not reference: skipped.
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const refs = files.filter(f => !f.startsWith('docs/')).map(f => new RegExp(`[\`/]${esc(path.basename(f))}(?![\\w-])`));
  const docLines = [];
  for (const d of docs) {
    if (files.includes(`docs/${d}`) || /\d{4}-\d\d(-\d\d)?\.md$/.test(d)) continue;
    const hits = new Map();
    let head = '';
    lines(path.join(repo, 'docs', d)).split('\n').forEach((l, i) => {
      if (/^#{2,4} /.test(l)) head = l.replace(/^#+ /, '');
      else if (refs.some(r => r.test(l))) { if (!hits.has(head)) hits.set(head, []); hits.get(head).push(i + 1); }
    });
    for (const [h, ls] of hits) docLines.push(`- docs/${d} «${h}»: righe ${ls.slice(0, 6).join(', ')}${ls.length > 6 ? ', …' : ''}`);
  }

  // Local docs of the installed versions (issue 125) for the apps the issue names ("adguard" for adguardhome).
  const docApps = [];
  let appDirs = [];
  try { appDirs = fs.readdirSync(docsDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { }
  for (const a of appDirs) {
    if (!new RegExp(`\\b${esc(a.replace(/home$/, ''))}`, 'i').test(text)) continue;
    let vers = [];
    try { vers = fs.readdirSync(path.join(docsDir, a)); } catch { }
    for (const v of vers) docApps.push(`- ${a} ${v}: \`grep -rn PATTERN ${path.join(docsDir, a, v)}\``);
  }

  const parts = [`## Contesto preparato per #${id} (issues-context: indice, non contenuti; leggi solo le righe che servono)`];
  if (linkLines.length) parts.push('### Issue collegate', ...linkLines);
  if (fileBlocks.length) parts.push('### File citati', ...fileBlocks);
  if (docApps.length) parts.push('### Documentazione delle versioni installate (indice: ' + path.join(docsDir, 'INDEX.md') + ')', ...docApps);
  if (docLines.length) parts.push('### Righe di docs/ che li nominano', ...docLines.slice(0, 15));
  const withFn = fnLines.length ? [...parts, '### Funzioni (file grandi, nome@riga)', ...fnLines] : parts;
  let out = withFn.join('\n');
  if (Buffer.byteLength(out) > max) out = parts.join('\n'); // over the cap: drop the function index first
  if (Buffer.byteLength(out) > max) out = Buffer.from(out).subarray(0, max - 20).toString().replace(/�?[^\n]*$/, '') + '\n[… troncato]';
  return out;
}

module.exports = { context, citedFiles, functions, lastProgress, MAX };

if (require.main === module) {
  const id = (process.argv[2] || '').replace(/^#/, '');
  if (!/^\d{1,}$/.test(id)) { console.error('uso: issues-context NNN [REPO]'); process.exit(2); }
  const repo = process.argv[3] || process.env.ISSUES_REPO || path.join(process.env.HOME || '', 'home-server');
  try { console.log(context(repo, id.padStart(3, '0'))); } catch (e) { console.error(`issues-context: ${e.message}`); process.exit(1); }
}
