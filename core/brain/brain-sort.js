#!/usr/bin/env node
'use strict';
// Second brain sorting job (user brain, timer every minute; cheap when idle). The agent starts only
// when INBOX has new or changed items that are ready: untouched for APPETITO_BRAIN_QUIET_S seconds
// (Obsidian saves while typing) or tagged #now, and at most every APPETITO_BRAIN_SORT_MINUTES
// minutes unless an item is tagged #now. It also starts for file names phones can't store (once
// per name). One run at a time, a backoff of an hour after a failure, and the worker's usage
// gate. Fixed rules: guard/brain/sort-rules.md (the brain can't change them).
// State in ~/state: seen (snapshot of items already sorted), tidy-tried, failed-at, runs/ (mode
// 700: they carry vault text, only brain reads them).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const CUR = process.env.APPETITO_CURRENT || '/opt/appetito/current';
const HOME = process.env.HOME || '/var/lib/appetito/brain';
const V = process.env.APPETITO_VAULT || path.join(HOME, 'vault');
const ST = process.env.APPETITO_BRAIN_STATE || path.join(HOME, 'state');
const QUIET = Number(process.env.APPETITO_BRAIN_QUIET_S || 600);
const F = {
	INBOX: process.env.APPETITO_VAULT_INBOX || 'Inbox', ARCHIVE: process.env.APPETITO_VAULT_ARCHIVE || 'Archive',
	PROJECTS: process.env.APPETITO_VAULT_PROJECTS || 'Projects', AREAS: process.env.APPETITO_VAULT_AREAS || 'Areas',
	RESOURCES: process.env.APPETITO_VAULT_RESOURCES || 'Resources', NOTES: process.env.APPETITO_VAULT_NOTES || 'Notes',
	DAILY: process.env.APPETITO_VAULT_DAILY || 'Daily', ATTACHMENTS: process.env.APPETITO_VAULT_ATTACHMENTS || 'Attachments',
	TEMPLATES: process.env.APPETITO_VAULT_TEMPLATES || 'Templates', IDEAS: `${process.env.APPETITO_VAULT_PROJECTS || 'Projects'}/${process.env.APPETITO_VAULT_IDEAS || 'Ideas'}`,
};
const BAD_NAME = /[\]:*?"<>|\\#^[]/;

const read = (f, d = '') => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };
const log = l => fs.appendFileSync(path.join(ST, 'sort.log'), `${new Date().toISOString()} ${l}\n`);
const setting = (k, d) => { try { return execFileSync(path.join(CUR, 'core', 'bin', 'appetito-setting'), [k], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return d; } };

function walk(dir, rel = '', out = [], skip = () => false) {
	let names = [];
	try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
	for (const e of names) {
		const r = rel ? `${rel}/${e.name}` : e.name;
		if (skip(e.name, r)) continue;
		if (e.isDirectory()) { out.push({ rel: r, dir: true, name: e.name, mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }); walk(path.join(dir, e.name), r, out, skip); }
		else if (e.isFile()) { const s = fs.statSync(path.join(dir, e.name)); out.push({ rel: r, name: e.name, mtime: s.mtimeMs, size: s.size }); }
	}
	return out;
}
// "mtime size path" for every INBOX item (hidden and Syncthing temp files excluded).
function snapshot() {
	return walk(path.join(V, F.INBOX), '', [], n => n.startsWith('.') || n.includes('~syncthing~'))
		.filter(x => !x.dir).map(x => ({ line: `${Math.floor(x.mtime / 1000)} ${x.size} ${x.rel}`, ...x }));
}

function main() {
	fs.mkdirSync(ST, { recursive: true, mode: 0o700 });
	const lock = path.join(ST, 'lock');
	try { fs.mkdirSync(lock); } catch {
		const pid = Number(read(path.join(lock, 'pid')).trim());
		try { if (pid) { process.kill(pid, 0); return 0; } } catch {}
		fs.rmSync(lock, { recursive: true, force: true }); fs.mkdirSync(lock);
	}
	fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
	try { return run(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

function run() {
	const now = Date.now();
	const seen = new Set(read(path.join(ST, 'seen')).split('\n').filter(Boolean));
	const snap = snapshot();
	const fresh = snap.filter(x => !seen.has(x.line));
	const urgent = fresh.filter(x => x.rel.endsWith('.md') && /(^|\s)#now\b/.test(read(path.join(V, F.INBOX, x.rel))));
	const ready = fresh.filter(x => now - x.mtime >= QUIET * 1000 || urgent.includes(x));
	// Names phones can't store, quiet for QUIET, not handed to a run before.
	const tried = new Set(read(path.join(ST, 'tidy-tried')).split('\n').filter(Boolean));
	const tidy = walk(V, '', [], n => n === '.git' || n === '.obsidian' || n.startsWith('.') || n.includes('~syncthing~'))
		.filter(x => BAD_NAME.test(x.name) && now - x.mtime >= QUIET * 1000 && !tried.has(x.rel)).map(x => x.rel);
	if (!ready.length && !tidy.length) return 0;
	const failed = Number(read(path.join(ST, 'failed-at')).trim());
	if (failed && now - failed < 3600e3) return 0;
	const every = Number(setting('APPETITO_BRAIN_SORT_MINUTES', '30')) * 60e3;
	const last = Number(read(path.join(ST, 'last-run')).trim());
	if (!urgent.length && last && now - last < every) return 0;
	try {
		const { gates } = require(path.join(CUR, 'core', 'worker', 'worker.js'));
		const g = gates();
		if (g.quotaUntil) { log(`skip: usage limit (${g.quotaWhy})`); return 0; }
	} catch {}

	const day = new Date().toISOString().slice(0, 10);
	let msg = `Date and time: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} (time zone ${Intl.DateTimeFormat().resolvedOptions().timeZone}).\n`;
	msg += `Folders: ${Object.entries(F).map(([k, v]) => `${k}=${v}`).join(', ')}.\n`;
	if (ready.length) msg += `\nSort these ${F.INBOX} items following the sorting rules:\n${ready.map(x => `- ${F.INBOX}/${x.rel}`).join('\n')}\n`;
	if (tidy.length) msg += `\nTidying: these names have forbidden characters; rename them as "File and folder names" says (fix the links too):\n${tidy.map(t => `- ${t}`).join('\n')}\n`;
	const run = `${day}_${new Date().toISOString().slice(11, 16).replace(':', '')}_sort`;
	const out = path.join(ST, 'runs', run);
	fs.mkdirSync(out, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(out, 'prompt.md'), msg);
	log(`run ${run}: ${ready.length} item(s), ${tidy.length} name(s) to tidy`);
	fs.writeFileSync(path.join(ST, 'last-run'), String(now));
	const r = spawnSync(path.join(CUR, 'guard', 'agent-run', 'agent-run'), ['--prompt', path.join(out, 'prompt.md'),
		'--system', path.join(CUR, 'guard', 'brain', 'sort-rules.md'), '--dir', V, '--profile', 'vault-edit', '--job', 'brain-sort',
		'--out', out, '--timeout', '1800'], { env: { ...process.env, APPETITO_ENV: '/etc/appetito/appetito.env',
		PATH: `${path.join(CUR, 'core', 'brain', 'bin')}:${process.env.PATH}` }, stdio: 'ignore' });
	const usage = JSON.parse(read(path.join(out, 'usage.json'), '{}') || '{}');
	if (usage.denied) log(`run ${run}: ${usage.denied} denied step(s)`);
	try { execFileSync(path.join(CUR, 'core', 'monitor', 'appetito-runlog'), [path.join(ST, 'runs')], { stdio: 'ignore' }); } catch {}
	if (r.status !== 0) {
		fs.writeFileSync(path.join(ST, 'failed-at'), String(now));
		log(`run ${run}: failed (agent-run exit ${r.status}, ${usage.status || 'no result'})`);
		return 1;
	}
	fs.rmSync(path.join(ST, 'failed-at'), { force: true });
	fs.writeFileSync(path.join(ST, 'tidy-tried'), [...new Set([...tried, ...tidy])].join('\n') + '\n');
	// New seen: this run's items as they are now (the brain's own edits, e.g. a question, don't
	// retrigger; the owner's answer changes the item and does) plus old lines still unchanged.
	const readyRel = new Set(ready.map(x => x.rel));
	const after = snapshot();
	fs.writeFileSync(path.join(ST, 'seen'), after.filter(x => readyRel.has(x.rel) || seen.has(x.line)).map(x => x.line).join('\n') + '\n');
	log(`run ${run}: done (${usage.tools ?? '?'} steps)`);
	return 0;
}

module.exports = { snapshot, BAD_NAME };
if (require.main === module) process.exit(main());
