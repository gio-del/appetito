'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-'));
const MAIN = path.join(T, 'repo'), VAR = path.join(T, 'var');
process.env.APPETITO_REPO = MAIN;
process.env.APPETITO_STATE = VAR;
process.env.APPETITO_CURRENT = path.resolve(__dirname, '..', '..');
process.env.APPETITO_SETTINGS_FILE = path.join(T, 'settings.env');
process.env.APPETITO_ENV_FILE = path.join(T, 'none.env');
fs.mkdirSync(path.join(VAR, 'worker'), { recursive: true });
fs.mkdirSync(path.join(VAR, 'deploy', 'branches'), { recursive: true });
const { queue, gates, issueOnMain, refreshLive } = require('./worker.js');

function issue(state, file, fields, body = '') {
	fs.mkdirSync(path.join(MAIN, 'issues', state), { recursive: true });
	fs.writeFileSync(path.join(MAIN, 'issues', state, file), `# ${file}\n\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${body}\n`);
}
issue('open', '001-low-todo.md', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'todo', Priority: 'low' });
issue('open', '002-urgent-todo.md', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'todo', Priority: 'urgent' });
issue('open', '003-backlog.md', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'backlog' });
issue('open', '004-monitor.md', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'todo', Labels: 'monitor' });
issue('open', '005-blocked.md', { Opened: '2026-01-01', 'Blocked on': 'user', Status: 'todo' });
issue('open', '006-epic.md', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'todo', Labels: 'epic' });
issue('open', '007-unapproved-proposal.md', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'todo', Source: 'brain' });
issue('open', '008-approved-proposal.md', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'todo', Source: 'system', Approved: '2026-01-02' });
issue('open', '009-waiting-tap.md', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'in-progress' });
issue('done', '010-done.md', { Opened: '2026-01-01', Closed: '2026-01-02', 'Blocked on': '-', Status: 'todo' });
fs.writeFileSync(path.join(VAR, 'deploy', 'branches', 'agent_009-waiting-tap.json'), JSON.stringify({ branch: 'agent/009-waiting-tap', state: 'waiting-guard', issue: '009' }));

test('queue: monitor first, then by priority; skips blocked, epics, backlog, done, waiting', () => {
	assert.deepStrictEqual(queue().map(i => i.id), ['004', '002', '008', '001']);
});
test('queue: a proposal without Approved: never runs (gate 3c, belt)', () => {
	assert.ok(!queue().some(i => i.id === '007'));
});
test('gates: a usage window over the limit stops the worker until it resets', () => {
	const later = Math.floor(Date.now() / 1000) + 3600;
	fs.writeFileSync(path.join(VAR, 'worker', 'limits.json'), JSON.stringify({ seven_day: { utilization: 0.6, resets_at: later, status: 'allowed' } }));
	assert.strictEqual(gates().quotaUntil, later);
	fs.writeFileSync(process.env.APPETITO_SETTINGS_FILE, 'APPETITO_AUTO_QUOTA_MAX=70\n');
	assert.strictEqual(gates().quotaUntil, 0);
	fs.writeFileSync(path.join(VAR, 'worker', 'limits.json'), JSON.stringify({ five_hour: { utilization: null, resets_at: later, status: 'rejected' } }));
	assert.strictEqual(gates().quotaUntil, later);
	fs.writeFileSync(path.join(VAR, 'worker', 'limits.json'), JSON.stringify({ five_hour: { utilization: 1, resets_at: 1, status: 'rejected' } }));
	assert.strictEqual(gates().quotaUntil, 0, 'an expired window no longer blocks');
});
test('gates: daily budgets of runs, tokens and cost', () => {
	const day = new Date().toISOString().slice(0, 10);
	fs.writeFileSync(path.join(VAR, 'worker', 'usage.jsonl'), [
		{ day, input_tokens: 4000, output_tokens: 1000, cost_usd: 1.5 }, { day, input_tokens: 1000, output_tokens: 0, cost_usd: 0.5 },
		{ day: '2000-01-01', input_tokens: 1e9, cost_usd: 1e6 }].map(x => JSON.stringify(x)).join('\n') + '\n');
	fs.writeFileSync(process.env.APPETITO_SETTINGS_FILE, 'APPETITO_AUTO_RUNS_DAY=2\n');
	assert.match(gates().budget, /runs 2\/2/);
	fs.writeFileSync(process.env.APPETITO_SETTINGS_FILE, 'APPETITO_AUTO_KTOKENS_DAY=6\n');
	assert.match(gates().budget, /tokens 6k\/6k/);
	fs.writeFileSync(process.env.APPETITO_SETTINGS_FILE, 'APPETITO_AUTO_COST_DAY=3\n');
	assert.strictEqual(gates().budget, '');
	fs.writeFileSync(process.env.APPETITO_SETTINGS_FILE, 'APPETITO_AUTO_COST_DAY=2\n');
	assert.match(gates().budget, /cost \$2.00\/\$2/);
});
test('issueOnMain: committed and with no tracker edit still waiting for the runner', () => {
	const R = path.join(T, 'onmain'), rel = 'issues/open/001-x.md', f = path.join(R, rel);
	const g = (...a) => require('node:child_process').execFileSync('git', ['-C', R, ...a], { stdio: 'ignore' });
	fs.mkdirSync(path.dirname(f), { recursive: true });
	g('init', '-q'); g('config', 'user.email', 'e@x'); g('config', 'user.name', 'e');
	fs.writeFileSync(f, 'Status: backlog\n');
	assert.strictEqual(issueOnMain('001-x.md', R), false, 'not committed yet');
	g('add', '-A'); g('commit', '-qm', 'x');
	assert.strictEqual(issueOnMain('001-x.md', R), true);
	fs.writeFileSync(f, 'Status: todo\n');
	assert.strictEqual(issueOnMain('001-x.md', R), false, 'the owner moved it and the runner has not committed it yet');
	g('commit', '-qam', 'y');
	assert.strictEqual(issueOnMain('001-x.md', R), true);
});
test('refreshLive: the tracker sees the steps while the agent runs (status.json, not only live.json)', () => {
	const W = path.join(VAR, 'worker'), out = path.join(T, 'run-out');
	fs.mkdirSync(path.join(W, 'lock'), { recursive: true });
	fs.writeFileSync(path.join(W, 'lock', 'pid'), String(process.pid));
	fs.writeFileSync(path.join(W, 'current.json'), JSON.stringify({ id: '001', run: 'r1', start: 1 }));
	fs.mkdirSync(out, { recursive: true });
	fs.writeFileSync(path.join(out, 'transcript.jsonl'), [{ t: 1000, kind: 'tool', category: 'shell', status: 'started' }, { t: 2000, kind: 'tool', category: 'edit', status: 'started' }].map(x => JSON.stringify(x)).join('\n') + '\n');
	refreshLive('r1', '001', out);
	const st = JSON.parse(fs.readFileSync(path.join(W, 'status.json'), 'utf8'));
	assert.strictEqual(st.code, 'working');
	assert.strictEqual(st.current.live.total, 2);
	assert.deepStrictEqual(st.current.live.tools, ['shell', 'edit']);
	fs.rmSync(path.join(W, 'lock'), { recursive: true }); fs.rmSync(path.join(W, 'current.json'));
});
test.after(() => fs.rmSync(T, { recursive: true, force: true }));
