'use strict';
// fake adapter: a deterministic backend for tests. It follows a JSON script instead of a model.
// APPETITO_FAKE_SCRIPT = file with {"steps": [...], "result": "text", "status": "success"}; steps:
//   {"sh": "command"}            shell step (needs a profile with shell), run with sh -c in --dir;
//                                 $AGENT_PROMPT holds the prompt text
//   {"write": "path", "content"} edit step (needs a profile with write)
//   {"text": "..."}              assistant text
//   {"limit": "five_hour", "utilization": 1, "status": "rejected"}
//   {"sleep": seconds}
// A step the profile doesn't allow is recorded as denied, like a real backend would.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

async function run({ prompt, dir, profile, timeout, transcript: tr, env }) {
	const f = env.APPETITO_FAKE_SCRIPT;
	const script = f ? JSON.parse(fs.readFileSync(f, 'utf8')) : { steps: [], result: 'nothing to do' };
	tr.start('fake', 'fake-1');
	const deadline = Date.now() + timeout * 1000;
	let n = 0, limited = false, failed = false;
	for (const s of script.steps || []) {
		if (Date.now() > deadline) { tr.result('timeout', n, ''); return { status: 'timeout', usage: {}, turns: n }; }
		n++;
		const id = `fake-${n}`;
		if (s.sh !== undefined) {
			if (!profile.shell) { tr.deny('shell', 'shell', s.sh); continue; }
			tr.toolStart(id, 'shell', 'shell');
			try {
				execFileSync('sh', ['-c', s.sh], { cwd: dir, env: { ...env, AGENT_PROMPT: prompt }, stdio: 'ignore', timeout: Math.max(1, deadline - Date.now()) });
				tr.toolEnd(id, true);
			} catch { tr.toolEnd(id, false); if (s.must) failed = true; }
		} else if (s.write !== undefined) {
			if (!profile.write) { tr.deny('write', 'edit', s.write); continue; }
			tr.toolStart(id, 'write', 'edit');
			const p = path.resolve(dir, s.write);
			fs.mkdirSync(path.dirname(p), { recursive: true });
			fs.writeFileSync(p, s.content ?? '');
			tr.toolEnd(id, true);
		} else if (s.text !== undefined) tr.text(s.text.length);
		else if (s.limit !== undefined) {
			tr.limit(s.limit, s.utilization ?? null, s.resets_at ?? Math.floor(Date.now() / 1000) + 3600, s.status || 'allowed');
			if (s.status === 'rejected') limited = true;
		} else if (s.sleep !== undefined) {
			await new Promise(r => setTimeout(r, Math.min(s.sleep * 1000, Math.max(0, deadline - Date.now()))));
			if (Date.now() >= deadline) { tr.result('timeout', n, ''); return { status: 'timeout', usage: {}, turns: n }; }
		}
	}
	const status = limited ? 'limit' : failed ? 'error' : script.status || 'success';
	tr.result(status, n, script.result || '');
	return { status, model: 'fake-1', usage: { input_tokens: prompt.length, output_tokens: 0, cost_usd: 0 }, turns: n, text: script.result || '' };
}

module.exports = { run };
