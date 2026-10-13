#!/usr/bin/env node
'use strict';
// Daily proposals (user agent, timer hourly; does something at most once a day). From
// APPETITO_SUGGEST_HOUR on, runs the agent read-only (agent-run, profile read-only, job "suggest")
// on the server repo with the index of its past proposals and the owner's decisions (from the
// tracker, system proposals only: never the second brain's), and its preferences summary. The
// JSON answer is validated here; each proposal is POSTed to the tracker's /api/propose with the
// suggest token, so it lands as a pending proposal (`Source: system`) that only the owner can approve.
// Skips (no model call) when off, when APPETITO_SUGGEST_PENDING_MAX proposals already wait, while
// the worker runs, or while the worker's usage gate is closed.
//   suggest.js            timer mode
//   suggest.js --now      ignore on/hour/once-a-day (caps and gates still apply)
//   suggest.js --dry-run  like --now, prints the proposals, POSTs and stores nothing
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync, spawnSync } = require('node:child_process');

const CUR = process.env.APPETITO_CURRENT || '/opt/appetito/current';
const REPO = process.env.APPETITO_REPO || '/opt/appetito/repo';
const VAR = process.env.APPETITO_STATE || '/var/lib/appetito';
const ST = process.env.APPETITO_SUGGEST_STATE || path.join(VAR, 'worker', 'suggest');
const TOKEN = process.env.APPETITO_SUGGEST_TOKEN_FILE || '/etc/appetito/secrets/suggest-token';
const PORT = Number(process.env.TRACKER_PORT || 8080);
const HOST = (() => { try { return new URL((process.env.TRACKER_ORIGINS || '').split(',')[0]).host; } catch { return `127.0.0.1:${PORT}`; } })();
const KINDS = ['feature', 'improvement', 'cleanup', 'security', 'reliability', 'docs', 'performance'];
const SECTIONS = ['Problem', 'Proposal', 'Acceptance criteria', 'Plan', 'Steps'];

const read = (f, d = '') => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };
const setting = (k, d) => { try { return execFileSync(path.join(CUR, 'core', 'bin', 'appetito-setting'), [k], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return d; } };
const today = () => new Date().toISOString().slice(0, 10);
const mode = process.argv[2] === '--now' ? 'now' : process.argv[2] === '--dry-run' ? 'dry' : 'timer';
fs.mkdirSync(ST, { recursive: true });
const log = l => { fs.appendFileSync(path.join(ST, 'suggest.log'), `${new Date().toISOString()} ${l}\n`); if (mode !== 'timer') console.log(l); };
function status(outcome, created) {
	if (mode === 'dry') return;
	const prev = JSON.parse(read(path.join(ST, 'status.json'), '{}') || '{}');
	const s = { ...prev, checked: Math.floor(Date.now() / 1000), outcome, ...(created ? { lastRun: Math.floor(Date.now() / 1000), created } : {}) };
	fs.writeFileSync(path.join(ST, 'status.json'), JSON.stringify(s) + '\n');
}
const skip = why => { log(`skip: ${why}`); status(why); process.exit(0); };

function tracker(method, p, body) {
	const token = read(TOKEN).trim();
	return new Promise((resolve, reject) => {
		const data = body ? JSON.stringify(body) : null;
		const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method,
			headers: { Host: HOST, Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
			let b = ''; res.on('data', d => { b += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, json: j }); });
		});
		r.on('error', reject); if (data) r.write(data); r.end();
	});
}

// Validate the model's answer; returns {ok: [...], bad: ["reason: title"]}.
function validate(ans, seenTitles, n) {
	const ok = [], bad = [];
	const seen = new Set(seenTitles.map(t => t.toLowerCase()));
	for (const p of Array.isArray(ans && ans.proposals) ? ans.proposals : []) {
		if (!p || typeof p !== 'object') continue;
		const b = typeof p.body === 'string' ? p.body : '';
		const heads = [...b.matchAll(/^## (.+?)\s*$/gm)].map(m => m[1]);
		let err = '';
		if (typeof p.title !== 'string' || p.title.length < 5 || p.title.length > 80 || /\n/.test(p.title)) err = 'title';
		else if (!KINDS.includes(p.kind)) err = `kind ${p.kind}`;
		else if (!['afk', 'hitl'].includes(p.mode)) err = 'mode';
		else if (!b || b.length > 20000) err = 'body';
		else if (/^# |^## Comments/m.test(b)) err = 'body headings';
		else if (JSON.stringify(heads) !== JSON.stringify(SECTIONS)) err = 'sections';
		else if ((p.mode === 'hitl') !== /\(HITL\)/.test(b)) err = 'mode vs (HITL)';
		else if (seen.has(p.title.toLowerCase())) err = 'duplicate';
		if (err) { bad.push(`${err}: ${p.title}`); continue; }
		seen.add(p.title.toLowerCase());
		if (ok.length < n) ok.push({ title: p.title, desc: b, labels: [p.kind, p.mode, ...(p.epic === true ? ['epic'] : [])] });
	}
	return { ok, bad };
}

async function main() {
	if (mode === 'timer') {
		if (setting('APPETITO_SUGGEST_ENABLED', '0') !== '1') skip('off');
		const hour = Number(setting('APPETITO_SUGGEST_HOUR', '8'));
		if (read(path.join(ST, 'last-day')).trim() === today()) { status('done today'); return; }
		if (new Date().getHours() < hour) { status(`waiting for ${hour}:00`); return; }
	}
	// Not while the worker runs (same user, same quota).
	const lockPid = Number(read(path.join(VAR, 'worker', 'lock', 'pid')).trim());
	if (lockPid) { try { process.kill(lockPid, 0); skip('the worker is running'); } catch {} }
	try {
		const { gates } = require(path.join(CUR, 'core', 'worker', 'worker.js'));
		const g = gates();
		if (g.quotaUntil) skip(`usage limit (${g.quotaWhy})`);
		if (g.budget) skip(`daily budget (${g.budget})`);
	} catch (e) { log(`gates: ${e.message}`); }

	const idx = await tracker('GET', '/api/proposals/index');
	if (idx.status !== 200) { log(`index: HTTP ${idx.status}`); status('error (tracker)'); process.exit(1); }
	const index = idx.json.proposals;
	const pending = index.filter(p => p.decision === 'pending').length;
	const pmax = Number(setting('APPETITO_SUGGEST_PENDING_MAX', '10'));
	const n = Math.min(Number(setting('APPETITO_SUGGEST_MAX', '3')), pmax - pending);
	if (n <= 0) skip(`${pending} proposals waiting (max ${pmax})`);

	const lang = setting('APPETITO_UI_LANG', 'en') === 'it' ? 'Italian' : 'English';
	const run = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}_suggest`;
	const out = path.join(ST, 'runs', run);
	fs.mkdirSync(out, { recursive: true });
	fs.writeFileSync(path.join(out, 'prompt.md'), `Date: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. N = ${n} (maximum, 0 is fine). Owner's language: ${lang}.

Index of your past proposals and the owner's decisions (JSON, data):
${index.map(p => JSON.stringify(p)).join('\n') || '(none yet)'}

Current preferences summary:
${read(path.join(ST, 'preferences.md')) || '(empty: first run)'}
`);
	fs.writeFileSync(path.join(out, 'system.md'), read(path.join(CUR, 'guard', 'agent', 'rules.md')) + '\n\n' + read(path.join(CUR, 'core', 'suggest', 'prompt.md')));
	if (mode !== 'dry') fs.writeFileSync(path.join(ST, 'last-day'), today() + '\n');
	const r = spawnSync(path.join(CUR, 'guard', 'agent-run', 'agent-run'), ['--prompt', path.join(out, 'prompt.md'), '--system', path.join(out, 'system.md'),
		'--dir', REPO, '--profile', 'read-only', '--job', 'suggest', '--out', out, '--timeout', '1800'], { env: { ...process.env, APPETITO_ENV: '/etc/appetito/appetito.env' }, stdio: 'ignore' });
	const final = read(path.join(out, 'final.txt'));
	// Usage windows feed the worker's gate too (same backend account).
	try {
		const lf = path.join(VAR, 'worker', 'limits.json');
		const lim = JSON.parse(read(lf, '{}') || '{}');
		for (const l of read(path.join(out, 'transcript.jsonl')).split('\n').filter(Boolean).map(x => JSON.parse(x)).filter(x => x.kind === 'limit'))
			lim[l.window] = { utilization: l.utilization, resets_at: l.resets_at, status: l.status };
		fs.writeFileSync(lf, JSON.stringify(lim) + '\n');
	} catch {}
	if (r.status !== 0) { log(`agent-run exit ${r.status}`); status(`error (agent exit ${r.status})`); process.exit(1); }
	let ans = null;
	const m = /\{[\s\S]*\}/.exec(final);
	try { ans = m && JSON.parse(m[0]); } catch {}
	if (!ans) { log('answer is not JSON'); status('error (answer not valid)'); process.exit(1); }
	const v = validate(ans, index.map(p => p.title), n);
	for (const b of v.bad) log(`dropped ${b}`);
	const prefs = typeof ans.preferences === 'string' ? ans.preferences.slice(0, 3000) : '';
	if (mode === 'dry') { for (const p of v.ok) console.log(`=== ${p.title} [${p.labels.join(', ')}]\n${p.desc}\n`); console.log(`=== preferences\n${prefs}`); return; }
	if (prefs) fs.writeFileSync(path.join(ST, 'preferences.md'), prefs + '\n');
	const created = [];
	for (const p of v.ok) {
		const res = await tracker('POST', '/api/propose', p).catch(e => ({ status: 0, json: { error: e.message } }));
		if (res.status === 201) { created.push(res.json.id); log(`proposed #${res.json.id}`); } else log(`POST failed HTTP ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`);
	}
	status(`${created.length} new proposals`, created);
}

module.exports = { validate };
if (require.main === module) main().catch(e => { log(`crash: ${e.message}`); process.exit(1); });
