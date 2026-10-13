'use strict';
// openai adapter: opencode (https://opencode.ai) against any OpenAI-compatible endpoint (Ollama,
// llama.cpp server, vLLM, a hosted API). opencode's JSON events are normalized here and only here.
// Settings: APPETITO_OPENAI_BASE_URL (required), APPETITO_OPENAI_MODEL (required),
// APPETITO_OPENAI_API_KEY_FILE (optional), APPETITO_OPENCODE_BIN (opencode).
// The profile becomes opencode's permission config: a denied tool is not offered to the model.
const fs = require('node:fs');
const path = require('node:path');
const { spawnBackend } = require('../lib.js');

const CAT = {
	read: 'read', list: 'search', glob: 'search', grep: 'search', codesearch: 'search',
	write: 'edit', edit: 'edit', patch: 'edit', multiedit: 'edit',
	bash: 'shell', webfetch: 'web', websearch: 'web', task: 'agent', todowrite: 'plan', todoread: 'plan',
};

function config(profile, env, system, out) {
	const base = env.APPETITO_OPENAI_BASE_URL, model = env.APPETITO_OPENAI_MODEL;
	if (!base || !model) throw new Error('APPETITO_OPENAI_BASE_URL and APPETITO_OPENAI_MODEL are required');
	const options = { baseURL: base };
	if (env.APPETITO_OPENAI_API_KEY_FILE) options.apiKey = `{file:${env.APPETITO_OPENAI_API_KEY_FILE}}`;
	const p = b => (b ? 'allow' : 'deny');
	const cfg = {
		$schema: 'https://opencode.ai/config.json',
		provider: { appetito: { npm: '@ai-sdk/openai-compatible', name: 'appetito', options, models: { [model]: { name: model } } } },
		model: `appetito/${model}`,
		small_model: `appetito/${model}`,
		autoupdate: false,
		share: 'disabled',
		permission: { edit: p(profile.write), bash: p(profile.shell), webfetch: p(profile.web) },
	};
	if (system) {
		const f = path.join(out, 'rules.md');
		fs.writeFileSync(f, system, { mode: 0o600 });
		cfg.instructions = [f];
	}
	const f = path.join(out, 'opencode.json');
	fs.writeFileSync(f, JSON.stringify(cfg, null, 1), { mode: 0o600 });
	return { file: f, model };
}

async function run({ prompt, system, dir, profile, out, timeout, transcript: tr, env }) {
	const { file, model } = config(profile, env, system, out);
	// opencode resolves relative paths against $PWD, not the process cwd.
	const childEnv = { ...env, PWD: dir, OPENCODE_CONFIG: file, OPENCODE_DISABLE_AUTOUPDATE: '1' };
	let turns = 0, errored = null, lastText = '', n = 0;
	const usage = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cost_usd: 0 };
	tr.start('openai', model);
	const r = await spawnBackend(env.APPETITO_OPENCODE_BIN || 'opencode', ['run', '--format', 'json', '--dir', dir, prompt], {
		cwd: dir, env: childEnv, timeout, out,
		onObj: o => {
			const part = o.part || {};
			if (o.type === 'step_start') turns++;
			else if (o.type === 'text') { lastText = part.text || ''; tr.text(lastText.length); }
			else if (o.type === 'tool_use') {
				const name = part.tool || 'unknown';
				const id = part.callID || part.id || `t${++n}`;
				const st = part.state || {};
				const cat = CAT[name] || 'other';
				if (st.status === 'error' && /permission|denied|rejected|not allowed/i.test(String(st.error || ''))) {
					const i = st.input || {};
					tr.deny(name, cat, i.command ?? i.filePath ?? i.url ?? JSON.stringify(i));
				} else {
					tr.toolStart(id, name, cat);
					tr.toolEnd(id, st.status === 'completed');
				}
			} else if (o.type === 'step_finish') {
				const t = part.tokens || {};
				usage.input_tokens += t.input || 0;
				usage.output_tokens += t.output || 0;
				usage.cache_read_tokens += t.cache?.read || 0;
				usage.cost_usd += part.cost || 0;
			} else if (o.type === 'error') errored = o.error?.data?.message || o.error?.name || 'error';
		},
	});
	let status;
	if (r.timedOut) status = 'timeout';
	else if (r.code === 0 && !errored) status = 'success';
	else status = 'error';
	const text = errored ? `opencode error: ${errored}` : r.error ? `could not start opencode: ${r.error}` : lastText;
	tr.result(status, turns, text);
	return { status, model, usage, turns, text };
}

module.exports = { run, config };
