#!/usr/bin/env node
'use strict';
// appetito worker (user agent): picks an open issue, runs the agent on it through agent-run in its
// own clone and branch, pushes the branch to the inbox for the deploy runner, and waits for the
// runner's verdict. Everything it knows about a run comes from agent-run's normalized transcript.
//
//   worker.js                  one scheduled round (appetito-worker.timer)
//   worker.js --manual [--issue NNN]   a round started from the tracker (also while paused)
//   worker.js --request        handle the tracker's start request (appetito-worker-request.path)
//   worker.js --queue          print the issues it would pick, best first
//   worker.js --status         rewrite status.json for the tracker's live page
//
// Picks (issues/README.md, "Shape rules"): open issues with `Blocked on: -`, not epics; `monitor`
// issues first, then `Status: todo|in-progress`; by priority. A proposal (`Source:`) only with
// `Approved:` (the tracker writes it). Skips an issue whose branch waits for the owner's tap.
// Gates: pause (setting), a backend usage window over APPETITO_AUTO_QUOTA_MAX %, a rejected
// window until it resets, and daily budgets of runs / tokens / cost. 3 attempts, then the issue
// goes to the owner (a commit on its branch, like any other change).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');

const OPT = process.env.APPETITO_OPT || '/opt/appetito';
const CUR = process.env.APPETITO_CURRENT || path.join(OPT, 'current');
const MAIN = process.env.APPETITO_REPO || path.join(OPT, 'repo');
const VAR = process.env.APPETITO_STATE || '/var/lib/appetito';
const ST = process.env.APPETITO_WORKER_STATE || path.join(VAR, 'worker');
const WORK = process.env.APPETITO_WORK || path.join(VAR, 'agent', 'work');
const INBOX = process.env.APPETITO_INBOX || path.join(VAR, 'agent', 'inbox.git');
const PUSHED = path.join(path.dirname(INBOX), 'pushed');
const DEPLOY = path.join(VAR, 'deploy', 'branches');
const REQUEST = process.env.APPETITO_WORKER_REQUEST || path.join(VAR, 'worker-request', 'request.json');
const AGENT_RUN = process.env.APPETITO_AGENT_RUN || path.join(CUR, 'guard', 'agent-run', 'agent-run');
const SETTING = path.join(CUR, 'core', 'bin', 'appetito-setting');
const RULES = [path.join(CUR, 'guard', 'agent', 'rules.md'), path.join(CUR, 'core', 'worker', 'prompt.md')];
const TIMEOUT = Number(process.env.APPETITO_WORKER_TIMEOUT || 3600);
const DEPLOY_WAIT = Number(process.env.APPETITO_DEPLOY_WAIT || 900);
const SLOTS = [7, 37]; // minutes of appetito-worker.timer

const read = (f, d = '') => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) {
	const tmp = `${f}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, JSON.stringify(v) + '\n', { mode: 0o644 });
	fs.renameSync(tmp, f);
}
const nowS = () => Math.floor(Date.now() / 1000);
const today = () => new Date().toISOString().slice(0, 10);
function git(dir, args, opts = {}) {
	return execFileSync('git', ['-C', dir, '-c', `safe.directory=${dir}`, '-c', 'safe.directory=' + MAIN, '-c', `safe.directory=${MAIN}/.git`, ...args],
		{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...opts }).trim();
}
function setting(k, d) {
	try { return execFileSync(SETTING, [k], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return d; }
}
const log = line => fs.appendFileSync(path.join(ST, 'worker.log'), `${new Date().toISOString()} ${line}\n`);
const event = e => fs.appendFileSync(path.join(ST, 'events.jsonl'), JSON.stringify({ t: nowS(), ...e }) + '\n');

// ---------------------------------------------------------------- issues
const FIELD = (text, k) => { const m = new RegExp(`^${k}:[ \\t]*(.*)$`, 'mi').exec(text); return m ? m[1].trim() : null; };
const labelsOf = t => (FIELD(t, 'Labels') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const titleOf = t => ((/^# (.*)$/m.exec(t) || [])[1] || '').slice(0, 160);
const PRIO = { urgent: 0, high: 1, medium: 2, none: 3, low: 4 };

function issueFiles(state) {
	try { return fs.readdirSync(path.join(MAIN, 'issues', state)).filter(f => /^\d{3,4}-[a-z0-9-]+\.md$/.test(f)); } catch { return []; }
}
function issueText(id) {
	for (const st of ['open', 'done']) {
		const f = issueFiles(st).find(x => x.startsWith(id + '-'));
		if (f) return { state: st, file: f, text: read(path.join(MAIN, 'issues', st, f)) };
	}
	return null;
}
function waitingBranches() {
	const out = new Set();
	try {
		for (const f of fs.readdirSync(DEPLOY)) {
			const s = readJson(path.join(DEPLOY, f));
			if (s && /^waiting-/.test(s.state) && s.issue) out.add(s.issue);
		}
	} catch {}
	return out;
}
function queue() {
	const waiting = waitingBranches();
	const out = [];
	for (const f of issueFiles('open')) {
		const t = read(path.join(MAIN, 'issues', 'open', f));
		const id = f.split('-')[0];
		if (!/^-/.test(FIELD(t, 'Blocked on') || '-')) continue;
		const lab = labelsOf(t);
		if (lab.includes('epic')) continue;
		if (FIELD(t, 'Source') && !FIELD(t, 'Approved')) continue; // a proposal nobody approved: never
		if (waiting.has(id)) continue;
		let rank;
		if (lab.includes('monitor')) rank = 0;
		else if (/^(todo|in-progress)$/i.test(FIELD(t, 'Status') || '')) rank = 1;
		else continue;
		const prio = (FIELD(t, 'Priority') || 'none').toLowerCase();
		out.push({ id, file: f, title: titleOf(t), priority: prio in PRIO ? prio : 'none', monitor: lab.includes('monitor'), rank: `${rank}${PRIO[prio] ?? 3}` });
	}
	return out.sort((a, b) => a.rank.localeCompare(b.rank) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- gates
function limits() { return readJson(path.join(ST, 'limits.json'), {}); } // window -> {utilization, resets_at, status}
function gates() {
	const max = Number(setting('APPETITO_AUTO_QUOTA_MAX', '50'));
	const now = nowS();
	let quotaUntil = 0, why = '';
	for (const [w, l] of Object.entries(limits())) {
		if (!l.resets_at || l.resets_at <= now) continue;
		const util = l.utilization == null ? null : Math.round(l.utilization * 100);
		if (l.status === 'rejected' || (util != null && util >= max)) {
			if (l.resets_at > quotaUntil) { quotaUntil = l.resets_at; why = l.status === 'rejected' ? `${w} limit reached` : `${w} at ${util}% (max ${max}%)`; }
		}
	}
	const day = usageToday();
	const runsMax = Number(setting('APPETITO_AUTO_RUNS_DAY', '0'));
	const ktokMax = Number(setting('APPETITO_AUTO_KTOKENS_DAY', '0'));
	const costMax = Number(setting('APPETITO_AUTO_COST_DAY', '0'));
	let budget = '';
	if (runsMax && day.runs >= runsMax) budget = `runs ${day.runs}/${runsMax} today`;
	else if (ktokMax && day.tokens >= ktokMax * 1000) budget = `tokens ${Math.round(day.tokens / 1000)}k/${ktokMax}k today`;
	else if (costMax && day.cost >= costMax) budget = `cost $${day.cost.toFixed(2)}/$${costMax} today`;
	return { paused: setting('APPETITO_AUTO_PAUSE', '0') === '1', quotaMax: max, quotaUntil, quotaWhy: why, budget,
		perRun: Number(setting('APPETITO_AUTO_MAX_PER_RUN', '1')), day, runsMax, ktokMax, costMax };
}
function usageToday() {
	const d = today();
	const out = { runs: 0, tokens: 0, cost: 0 };
	for (const l of read(path.join(ST, 'usage.jsonl')).split('\n')) {
		let u; try { u = JSON.parse(l); } catch { continue; }
		if (u.day !== d) continue;
		out.runs++; out.tokens += (u.input_tokens || 0) + (u.output_tokens || 0); out.cost += u.cost_usd || 0;
	}
	return out;
}

// ---------------------------------------------------------------- lock
const LOCK = () => path.join(ST, 'lock');
function lock() {
	try { fs.mkdirSync(LOCK()); } catch {
		const pid = Number(read(path.join(LOCK(), 'pid')).trim());
		if (pid && alive(pid)) return false;
		fs.rmSync(LOCK(), { recursive: true, force: true });
		try { fs.mkdirSync(LOCK()); } catch { return false; }
	}
	fs.writeFileSync(path.join(LOCK(), 'pid'), String(process.pid));
	return true;
}
function unlock() { fs.rmSync(LOCK(), { recursive: true, force: true }); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function working() { const pid = Number(read(path.join(LOCK(), 'pid')).trim()); return pid > 0 && alive(pid); }

// ---------------------------------------------------------------- clone and branch
function prepare(branch) {
	if (!fs.existsSync(path.join(WORK, '.git'))) {
		fs.mkdirSync(path.dirname(WORK), { recursive: true });
		execFileSync('git', ['-c', 'safe.directory=' + MAIN, '-c', `safe.directory=${MAIN}/.git`, 'clone', '-q', MAIN, WORK], { stdio: ['ignore', 'ignore', 'pipe'] });
	}
	if (!fs.existsSync(INBOX)) execFileSync('git', ['init', '-q', '--bare', INBOX], { stdio: 'ignore' });
	git(WORK, ['config', 'user.name', 'appetito agent']);
	git(WORK, ['config', 'user.email', 'agent@localhost']);
	git(WORK, ['fetch', '-q', 'origin', 'main']);
	git(WORK, ['checkout', '-q', '-f', '-B', branch, 'origin/main']);
	git(WORK, ['reset', '-q', '--hard', 'origin/main']);
	git(WORK, ['clean', '-q', '-fdx']);
	return git(WORK, ['rev-parse', 'HEAD']);
}
const slugOf = f => f.replace(/^\d+-/, '').replace(/\.md$/, '').slice(0, 50).replace(/-+$/, '');

// Commit whatever the run left uncommitted, so nothing is lost between runs.
function commitLeftovers(id) {
	if (!git(WORK, ['status', '--porcelain'])) return;
	git(WORK, ['add', '-A']);
	git(WORK, ['commit', '-q', '-m', `#${id}: work left uncommitted by the run`]);
}
function issuePathInWork(id) {
	for (const st of ['open', 'done']) {
		try {
			const f = fs.readdirSync(path.join(WORK, 'issues', st)).find(x => x.startsWith(id + '-') && x.endsWith('.md'));
			if (f) return path.join(WORK, 'issues', st, f);
		} catch {}
	}
	return null;
}
function addComment(file, author, text) {
	let t = read(file);
	if (!/^## Comments\s*$/m.test(t)) t = t.replace(/\n*$/, '\n\n## Comments\n');
	const d = new Date();
	const pad = n => String(n).padStart(2, '0');
	t += `\n### ${today()} ${pad(d.getHours())}:${pad(d.getMinutes())} (${author})\n${text.trim()}\n`;
	fs.writeFileSync(file, t);
}
function push(branch) {
	git(WORK, ['push', '-q', '--force', INBOX, `${branch}:refs/heads/${branch}`]);
	fs.writeFileSync(PUSHED, String(nowS()));
}
function waitDeploy(branch, sha) {
	const f = path.join(DEPLOY, branch.replace(/\//g, '_') + '.json');
	const end = Date.now() + DEPLOY_WAIT * 1000;
	return new Promise(resolve => {
		const tick = () => {
			const s = readJson(f);
			if (s && s.sha === sha && s.state && s.state !== 'pending') return resolve(s);
			if (Date.now() > end) return resolve({ state: 'pending' });
			setTimeout(tick, 3000);
		};
		tick();
	});
}

// ---------------------------------------------------------------- one issue
function runAgent(args, live) {
	return new Promise(resolve => {
		const env = { ...process.env, APPETITO_ENV: '/etc/appetito/appetito.env' };
		const p = spawn(AGENT_RUN, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
		let err = '';
		p.stderr.on('data', d => { err = (err + d).slice(-2000); });
		const t = setInterval(live, 5000);
		p.on('close', code => { clearInterval(t); live(); resolve({ code: code ?? 1, err }); });
	});
}

function transcript(out) {
	return read(path.join(out, 'transcript.jsonl')).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
// Live view for the tracker: categories and statuses only (transcript never holds tool input).
function liveOf(out) {
	const recs = transcript(out);
	const tools = recs.filter(r => r.kind === 'tool' && r.status === 'started').map(r => r.category);
	const counts = {};
	for (const c of tools) counts[c] = (counts[c] || 0) + 1;
	const last = recs.length ? Math.floor(recs[recs.length - 1].t / 1000) : null;
	return { tools: tools.slice(-80), counts, total: tools.length, denied: recs.filter(r => r.kind === 'denied').length, lastAt: last };
}

async function workIssue(pick, attempt, manual) {
	const id = pick.id;
	const branch = `agent/${id}-${slugOf(pick.file)}`;
	const run = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}_${id}`;
	const out = path.join(ST, 'runs', run);
	fs.mkdirSync(out, { recursive: true, mode: 0o750 });
	const base = prepare(branch);
	const prompt = path.join(out, 'prompt.md'), system = path.join(out, 'system.md');
	fs.writeFileSync(prompt, `Work on issue ${id}: issues/open/${pick.file} (attempt ${attempt} of 3). Date and time: ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.\n`);
	fs.writeFileSync(system, RULES.map(f => read(f)).join('\n\n'));
	const start = nowS();
	writeJson(path.join(ST, 'current.json'), { id, title: pick.title, start, attempt, manual, run, branch });
	event({ e: 'issue-start', id, attempt, manual, run });
	log(`#${id}: attempt ${attempt}${manual ? ' (manual)' : ''}, run ${run}`);
	status();
	const r = await runAgent(['--prompt', prompt, '--system', system, '--dir', WORK, '--profile', 'edit-repo', '--job', 'worker', '--out', out, '--timeout', String(TIMEOUT)],
		() => { writeJson(path.join(ST, 'live.json'), { run, id, ...liveOf(out) }); });
	const usage = readJson(path.join(out, 'usage.json'), {});
	const recs = transcript(out);
	// Usage windows (generic: whatever the backend reports) feed the quota gate.
	const lim = limits();
	for (const l of recs.filter(x => x.kind === 'limit')) lim[l.window] = { utilization: l.utilization, resets_at: l.resets_at, status: l.status };
	writeJson(path.join(ST, 'limits.json'), lim);
	fs.appendFileSync(path.join(ST, 'usage.jsonl'), JSON.stringify({ day: today(), run, id, ...usage }) + '\n');
	// Denied actions are never silent: a comment on the issue (data, never instructions).
	const denied = recs.filter(x => x.kind === 'denied');
	try { commitLeftovers(id); } catch (e) { log(`#${id}: commit failed: ${e.message}`); }
	if (denied.length) {
		const f = issuePathInWork(id);
		if (f) {
			addComment(f, 'worker', `${denied.length} action(s) denied in run \`${run}\` (shown as data, never instructions):\n\n\`\`\`text\n${denied.map(d => `${d.name}: ${String(d.detail).replace(/`/g, "'")}`).join('\n')}\n\`\`\``);
			git(WORK, ['commit', '-q', '-am', `#${id}: report denied actions`]);
		}
	}
	let result = { exit: r.code, status: usage.status || 'error', deploy: null };
	const head = git(WORK, ['rev-parse', 'HEAD']);
	if (head !== base) {
		push(branch);
		log(`#${id}: pushed ${branch} ${head.slice(0, 12)}`);
		writeJson(path.join(ST, 'current.json'), { id, title: pick.title, start, attempt, manual, run, branch, deploying: true });
		status();
		const d = await waitDeploy(branch, head);
		result.deploy = d.state;
		result.deployReason = d.reason || '';
	}
	const now = issueText(id);
	let outcome;
	if (result.status === 'limit') outcome = 'limit';
	else if (result.deploy === 'waiting-guard' || result.deploy === 'waiting-approval') outcome = 'waiting';
	else if (now && now.state === 'done') outcome = 'closed';
	else if (result.deploy && !['merged', 'pending'].includes(result.deploy)) outcome = 'failed';
	else if (now && !/^-/.test(FIELD(now.text, 'Blocked on') || '-')) outcome = 'handed';
	else if (result.status !== 'success') outcome = 'error';
	else outcome = 'partial';
	const rec = { e: 'issue-end', id, run, attempt, manual, start, end: nowS(), outcome, deploy: result.deploy, deployReason: result.deployReason,
		turns: usage.turns ?? null, tools: usage.tools ?? null, tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0), cost: usage.cost_usd ?? null,
		denied: denied.length, backend: usage.backend || null, status: result.status };
	event(rec);
	log(`#${id}: ${outcome} (agent ${result.status}, deploy ${result.deploy || 'nothing to push'})`);
	fs.rmSync(path.join(ST, 'current.json'), { force: true });
	return rec;
}

// Three attempts without closing or handing over: the issue goes to the owner.
function handOver(pick) {
	const branch = `agent/${pick.id}-${slugOf(pick.file)}`;
	prepare(branch);
	const f = issuePathInWork(pick.id);
	if (!f) return;
	let t = read(f).replace(/^Blocked on:.*$/m, 'Blocked on: user (the worker could not close it in 3 attempts)');
	fs.writeFileSync(f, t);
	addComment(f, 'worker', 'Handed over after 3 attempts without closing it: see the comments and the runs above, then unblock it (or rewrite it) to try again.');
	git(WORK, ['commit', '-q', '-am', `#${pick.id}: hand over after 3 attempts`]);
	push(branch);
	event({ e: 'handover', id: pick.id });
	log(`#${pick.id}: handed over after 3 attempts`);
}

// ---------------------------------------------------------------- round
async function round(manual, only) {
	fs.mkdirSync(path.join(ST, 'attempts'), { recursive: true });
	if (!lock()) { log('already running'); return 0; }
	let ended = 'interrupted';
	event({ e: 'round-start', manual, only: only || null });
	try {
		const g = gates();
		if (!manual && g.paused) { ended = 'skip:paused'; return 0; }
		if (g.quotaUntil) { ended = `skip:quota:${g.quotaWhy}`; return 0; }
		if (g.budget) { ended = `skip:budget:${g.budget}`; return 0; }
		const per = only ? 1 : g.perRun;
		const done = [];
		for (let k = 0; k < per; k++) {
			const q = queue();
			const pick = only ? q.find(i => i.id === only) : q[0];
			if (!pick) { ended = done.length ? `worked:${done.join(',')}` : only ? 'skip:notpickable' : 'skip:empty'; return 0; }
			const af = path.join(ST, 'attempts', pick.id);
			const n = Number(read(af, '0')) + 1;
			if (n > 3) { handOver(pick); fs.rmSync(af, { force: true }); done.push(`${pick.id}:gaveup`); ended = `worked:${done.join(',')}`; return 0; }
			fs.writeFileSync(af, String(n));
			const rec = await workIssue(pick, n, manual);
			done.push(`${pick.id}:${rec.outcome}`);
			ended = `worked:${done.join(',')}`;
			// A run cut off by a backend limit doesn't count as an attempt.
			if (rec.outcome === 'limit') fs.writeFileSync(af, String(n - 1));
			if (['closed', 'handed', 'waiting'].includes(rec.outcome)) fs.rmSync(af, { force: true });
			if (rec.outcome !== 'closed') return 0;
			const g2 = gates();
			if ((!manual && g2.paused) || g2.quotaUntil || g2.budget) return 0;
		}
		return 0;
	} finally {
		event({ e: 'round-end', result: ended });
		unlock();
		status();
		try { execFileSync(path.join(CUR, 'core', 'monitor', 'appetito-runlog'), [path.join(ST, 'runs')], { stdio: 'ignore' }); } catch {}
	}
}

// ---------------------------------------------------------------- manual start request
const REQ_ANSWER = () => path.join(ST, 'request.json');
function handleRequest() {
	const req = readJson(REQUEST);
	if (!req || !/^[a-f0-9]{16}$/.test(req.id || '')) return null;
	if ((readJson(REQ_ANSWER()) || {}).id === req.id) return null;
	const issue = req.issue == null ? null : /^\d{3,4}$/.test(String(req.issue)) ? String(req.issue) : 'bad';
	const answer = (result, reason = '') => {
		writeJson(REQ_ANSWER(), { id: req.id, handled: nowS(), result, reason, issue });
		event({ e: 'request', id: req.id, result, reason, issue });
		status();
	};
	if (issue === 'bad') return answer('refused', 'bad issue number'), null;
	if (nowS() - Number(req.at || 0) > 600) return answer('refused', 'request expired'), null;
	if (working()) return answer('refused', 'already working'), null;
	answer('started');
	return { issue };
}

// ---------------------------------------------------------------- status for the tracker
function nextSlot(t = Date.now()) {
	const d = new Date(t); d.setSeconds(0, 0);
	for (let i = 0; i < 1440; i++) {
		if (SLOTS.includes(d.getMinutes()) && d.getTime() >= t - 59e3) return Math.floor(d.getTime() / 1000);
		d.setMinutes(d.getMinutes() + 1);
	}
	return Math.floor(d.getTime() / 1000);
}
function rounds(events) {
	const out = [];
	let cur = null;
	for (const e of events) {
		if (e.e === 'round-start') { cur = { start: e.t, manual: !!e.manual, issues: [] }; out.push(cur); }
		else if (e.e === 'issue-start' && cur) cur.issues.push({ id: e.id, start: e.t, attempt: e.attempt, manual: e.manual, outcome: 'running', run: e.run });
		else if (e.e === 'issue-end' && cur) {
			const i = cur.issues.find(x => x.run === e.run);
			if (i) Object.assign(i, { end: e.end, outcome: e.outcome, turns: e.turns, cost: e.cost == null ? null : Math.round(e.cost * 100) / 100, tokens: e.tokens, denied: e.denied, deploy: e.deploy, deployReason: e.deployReason });
		} else if (e.e === 'handover' && cur) cur.issues.push({ id: e.id, start: e.t, end: e.t, outcome: 'gaveup' });
		else if (e.e === 'round-end' && cur) { cur.end = e.t; cur.result = e.result; cur = null; }
		else if (e.e === 'request' && e.result === 'refused') out.push({ start: e.t, end: e.t, request: true, manual: true, issues: [], result: `refused:${e.reason}` });
	}
	const live = working();
	const last = out[out.length - 1];
	for (const r of out) {
		r.live = live && r === last && !r.end;
		for (const i of r.issues) if (i.outcome === 'running' && !(r.live && i === r.issues[r.issues.length - 1])) i.outcome = 'lost';
		if (!r.end && !r.live) r.end = r.start;
	}
	// Collapse repeated identical skips.
	const merged = [];
	for (const r of out) {
		const p = merged[merged.length - 1];
		if (p && !r.issues.length && !p.issues.length && !r.request && !p.request && p.result === r.result && !r.live) { p.count = (p.count || 1) + 1; p.end = r.end; continue; }
		merged.push(r);
	}
	return merged.slice(-14).map(r => ({ ...r, issues: r.issues.map(i => ({ ...i, title: (issueText(i.id) && titleOf(issueText(i.id).text)) || '' })) }));
}
function status() {
	const events = read(path.join(ST, 'events.jsonl')).split('\n').slice(-3000).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
	const g = gates();
	const q = queue();
	const cur = working() ? readJson(path.join(ST, 'current.json')) : null;
	const live = readJson(path.join(ST, 'live.json'));
	let code;
	if (cur) code = cur.deploying ? 'deploying' : 'working';
	else if (g.paused) code = 'paused';
	else if (g.quotaUntil) code = 'quota';
	else if (g.budget) code = 'budget';
	else if (!q.length) code = 'empty';
	else code = 'idle';
	const lastEnd = [...events].reverse().find(e => e.e === 'issue-end');
	if (code === 'idle' && lastEnd && lastEnd.outcome === 'error' && nowS() - lastEnd.end < 3600) code = 'error';
	const open = issueFiles('open').map(f => read(path.join(MAIN, 'issues', 'open', f)));
	const mon = open.filter(t => labelsOf(t).includes('monitor') && !labelsOf(t).includes('lint'));
	const lint = open.filter(t => labelsOf(t).includes('monitor') && labelsOf(t).includes('lint'));
	const windows = Object.entries(limits()).filter(([, l]) => l.resets_at > nowS()).map(([name, l]) => ({ name, util: l.utilization == null ? null : Math.round(l.utilization * 100), reset: l.resets_at, rejected: l.status === 'rejected' }));
	const deploys = [];
	try {
		for (const f of fs.readdirSync(DEPLOY).filter(x => x.endsWith('.json'))) { const s = readJson(path.join(DEPLOY, f)); if (s) deploys.push(s); }
	} catch {}
	deploys.sort((a, b) => b.at - a.at);
	const s = {
		v: 2, checked: nowS(), code,
		current: cur ? { ...cur, live: live && live.run === cur.run ? live : { tools: [], counts: {}, total: 0 } } : null,
		lastRun: !cur && live ? live : null,
		nextSlot: nextSlot(),
		gates: { paused: g.paused, quotaMax: g.quotaMax, quotaUntil: g.quotaUntil || null, quotaWhy: g.quotaWhy, budget: g.budget, perRun: g.perRun,
			day: g.day, runsMax: g.runsMax, ktokMax: g.ktokMax, costMax: g.costMax, windows },
		queue: q.slice(0, 10).map(({ rank, file, ...i }) => i), queueTotal: q.length,
		counts: { errors: mon.length, errorsBlocked: mon.filter(t => !/^-/.test(FIELD(t, 'Blocked on') || '-')).length, lint: lint.length },
		rounds: rounds(events),
		request: readJson(REQ_ANSWER()),
		deploys: deploys.slice(0, 10).map(d => ({ branch: d.branch, sha: d.sha, state: d.state, reason: d.reason, issue: d.issue, at: d.at })),
	};
	writeJson(path.join(ST, 'status.json'), s);
	return s;
}

// ---------------------------------------------------------------- main
async function main() {
	fs.mkdirSync(ST, { recursive: true });
	const a = process.argv.slice(2);
	if (a[0] === '--queue') { for (const i of queue()) console.log(`${i.id}\t${i.priority}\t${i.monitor ? 'monitor' : 'todo'}\t${i.title}`); return 0; }
	if (a[0] === '--status') { status(); return 0; }
	if (a[0] === '--request') { const r = handleRequest(); return r ? round(true, r.issue) : 0; }
	const manual = a.includes('--manual');
	const i = a.indexOf('--issue');
	const only = i >= 0 ? a[i + 1] : null;
	if (only && !/^\d{3,4}$/.test(only)) { console.error('bad --issue'); return 2; }
	return round(manual, only);
}

module.exports = { queue, gates, rounds, nextSlot };
if (require.main === module) main().then(c => process.exit(c || 0), e => { console.error(e.stack || e); try { log(`crash: ${e.message}`); } catch {} process.exit(1); });
