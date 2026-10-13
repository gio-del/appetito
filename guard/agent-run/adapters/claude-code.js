'use strict';
// claude-code adapter: headless `claude -p` with stream-json output, normalized here and only here.
// Settings: APPETITO_CLAUDE_BIN (claude), APPETITO_CLAUDE_MODEL, APPETITO_CLAUDE_MAX_BUDGET_USD (10),
// APPETITO_CLAUDE_PERMISSION_MODE (acceptEdits | auto | default; bypass is refused).
const { spawnBackend } = require('../lib.js');

const CAT = {
	Read: 'read', NotebookRead: 'read', LS: 'read',
	Glob: 'search', Grep: 'search', ToolSearch: 'search',
	Edit: 'edit', MultiEdit: 'edit', Write: 'edit', NotebookEdit: 'edit',
	Bash: 'shell', BashOutput: 'shell', KillShell: 'shell', Monitor: 'shell',
	WebFetch: 'web', WebSearch: 'web',
	Task: 'agent', Agent: 'agent',
	TodoWrite: 'plan',
};
const category = name => CAT[name] || (name.startsWith('mcp__') ? 'other' : 'other');

// Profile → tools. Everything not granted is listed as disallowed, so a headless run gets a
// denial instead of a prompt nobody answers.
function tools(profile) {
	const allow = ['Read', 'Glob', 'Grep', 'LS', 'TodoWrite'];
	if (profile.write) allow.push('Edit', 'MultiEdit', 'Write', 'NotebookEdit');
	if (profile.shell) allow.push('Bash', 'BashOutput', 'KillShell');
	if (profile.web) allow.push('WebFetch', 'WebSearch');
	const all = Object.keys(CAT);
	const deny = all.filter(t => !allow.includes(t));
	// Belt only: the calling user has no sudo anyway.
	if (profile.shell) deny.push('Bash(sudo:*)', 'Bash(su:*)', 'Bash(doas:*)', 'Bash(pkexec:*)');
	return { allow, deny };
}

function detail(input) {
	if (!input || typeof input !== 'object') return String(input ?? '');
	return input.command ?? input.file_path ?? input.url ?? input.pattern ?? JSON.stringify(input);
}

async function run({ prompt, system, dir, profile, out, timeout, transcript: tr, env }) {
	const mode = env.APPETITO_CLAUDE_PERMISSION_MODE || (profile.write ? 'acceptEdits' : 'default');
	if (!['acceptEdits', 'auto', 'default', 'plan'].includes(mode)) throw new Error(`permission mode ${mode} not allowed`);
	const { allow, deny } = tools(profile);
	const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
		'--permission-mode', mode, '--allowedTools', allow.join(','), '--disallowedTools', deny.join(','),
		'--max-budget-usd', String(env.APPETITO_CLAUDE_MAX_BUDGET_USD || 10)];
	if (env.APPETITO_CLAUDE_MODEL) args.push('--model', env.APPETITO_CLAUDE_MODEL);
	if (system) args.push('--append-system-prompt', system);

	let model = null, result = null, limited = false;
	const childEnv = { ...env };
	// Never let a run turn on the dangerous mode through the environment.
	delete childEnv.CLAUDE_CODE_DANGEROUSLY_SKIP_PERMISSIONS;
	tr.start('claude-code', env.APPETITO_CLAUDE_MODEL || null);
	const r = await spawnBackend(env.APPETITO_CLAUDE_BIN || 'claude', args, {
		cwd: dir, env: childEnv, timeout, out,
		onObj: o => {
			if (o.type === 'system' && o.subtype === 'init') model = o.model || model;
			else if (o.type === 'assistant') {
				for (const c of o.message?.content || []) {
					if (c.type === 'tool_use') tr.toolStart(c.id, c.name, category(c.name));
					else if (c.type === 'text') tr.text((c.text || '').length);
				}
			} else if (o.type === 'user') {
				for (const c of o.message?.content || []) if (c.type === 'tool_result') tr.toolEnd(c.tool_use_id, !c.is_error);
			} else if (o.type === 'rate_limit_event') {
				const i = o.rate_limit_info || {};
				const w = i.unifiedWindows || {};
				for (const [name, v] of Object.entries(w)) {
					const status = name === i.rateLimitType ? i.status : 'allowed';
					tr.limit(name, v.utilization ?? null, v.resetsAt ?? null, status);
				}
				if (!Object.keys(w).length) tr.limit(i.rateLimitType || 'unknown', null, i.resetsAt ?? null, i.status);
				if (i.status === 'rejected') limited = true;
			} else if (o.type === 'result') result = o;
		},
	});
	for (const d of result?.permission_denials || []) tr.deny(d.tool_name, category(d.tool_name), detail(d.tool_input));
	const u = result?.usage || {};
	const usage = {
		input_tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) || null,
		output_tokens: u.output_tokens ?? null,
		cache_read_tokens: u.cache_read_input_tokens ?? null,
		cost_usd: result?.total_cost_usd ?? null,
	};
	let status;
	if (r.timedOut) status = 'timeout';
	else if (limited && (!result || result.is_error)) status = 'limit';
	else if (result && !result.is_error && r.code === 0) status = 'success';
	else status = 'error';
	const text = result?.result ?? (r.error ? `could not start claude: ${r.error}` : '');
	tr.result(status, result?.num_turns ?? null, text);
	return { status, model: model || env.APPETITO_CLAUDE_MODEL || null, usage, turns: result?.num_turns ?? null, text };
}

module.exports = { run, tools };
