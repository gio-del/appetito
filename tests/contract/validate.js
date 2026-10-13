#!/usr/bin/env node
'use strict';
// validate.js OUT_DIR: checks agent-run's outputs against docs/agent-run.md. Exit 1 with a reason.
const fs = require('node:fs');
const path = require('node:path');
const out = process.argv[2];
const fail = m => { console.error(`contract: ${m}`); process.exit(1); };
const CATS = ['read', 'search', 'edit', 'shell', 'web', 'agent', 'plan', 'other'];
const lines = fs.readFileSync(path.join(out, 'transcript.jsonl'), 'utf8').trim().split('\n');
if (!lines.length) fail('empty transcript');
const recs = lines.map((l, i) => { try { return JSON.parse(l); } catch { fail(`line ${i + 1} is not JSON`); } });
recs.forEach((r, i) => {
	if (typeof r.t !== 'number') fail(`line ${i + 1}: no t`);
	switch (r.kind) {
	case 'start': if (typeof r.backend !== 'string') fail('start without backend'); break;
	case 'tool':
		if (!CATS.includes(r.category)) fail(`bad category ${r.category}`);
		if (!['started', 'ok', 'error'].includes(r.status)) fail(`bad tool status ${r.status}`);
		if ('input' in r || 'args' in r) fail('tool input must never be recorded');
		break;
	case 'text': if (!Number.isInteger(r.chars)) fail('text without chars'); if ('text' in r) fail('text content must not be recorded'); break;
	case 'denied': if (!CATS.includes(r.category) || typeof r.detail !== 'string' || r.detail.length > 200) fail('bad denied record'); break;
	case 'limit': if (!['allowed', 'rejected', 'allowed_warning'].includes(r.status)) fail(`bad limit status ${r.status}`); break;
	case 'result': if (i !== recs.length - 1) fail('result is not the last line'); break;
	default: fail(`unknown kind ${r.kind}`);
	}
});
if (recs[0].kind !== 'start') fail('first record is not start');
const last = recs[recs.length - 1];
if (last.kind !== 'result' || !['success', 'error', 'limit', 'timeout'].includes(last.status)) fail('no valid result line');
const u = JSON.parse(fs.readFileSync(path.join(out, 'usage.json'), 'utf8'));
for (const k of ['backend', 'model', 'profile', 'input_tokens', 'output_tokens', 'cost_usd', 'turns', 'tools', 'denied', 'duration_ms', 'status'])
	if (!(k in u)) fail(`usage.json lacks ${k}`);
if (u.status !== last.status) fail('usage.status differs from result');
if (!fs.existsSync(path.join(out, 'final.txt'))) fail('no final.txt');
for (const f of ['raw.jsonl', 'stderr.txt']) {
	const p = path.join(out, f);
	if (fs.existsSync(p) && (fs.statSync(p).mode & 0o077)) fail(`${f} must be mode 600`);
}
console.log(`contract ok: ${last.status}, ${u.tools} tools, ${u.denied} denied`);
