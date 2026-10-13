'use strict';
// Shared pieces of agent-run: the normalized transcript writer and helpers for adapters.
// See docs/agent-run.md for the contract. Nothing outside guard/agent-run reads vendor formats.
const fs = require('node:fs');
const path = require('node:path');

const CATEGORIES = ['read', 'search', 'edit', 'shell', 'web', 'agent', 'plan', 'other'];

class Transcript {
	constructor(out) {
		this.out = out;
		this.fd = fs.openSync(path.join(out, 'transcript.jsonl'), 'w', 0o640);
		this.open = new Map(); // tool id -> {category, name}
		this.denied = 0;
		this.tools = 0;
	}
	write(rec) {
		fs.writeSync(this.fd, JSON.stringify({ t: Date.now(), ...rec }) + '\n');
	}
	start(backend, model) { this.started = true; this.write({ kind: 'start', backend, model: model || null }); }
	toolStart(id, name, category) {
		if (!CATEGORIES.includes(category)) category = 'other';
		this.open.set(id, { name, category });
		this.tools++;
		this.write({ kind: 'tool', id, name, category, status: 'started' });
	}
	toolEnd(id, ok) {
		const t = this.open.get(id);
		if (!t) return;
		this.open.delete(id);
		this.write({ kind: 'tool', id, name: t.name, category: t.category, status: ok ? 'ok' : 'error' });
	}
	text(chars) { if (chars > 0) this.write({ kind: 'text', chars }); }
	// A denied action keeps a short detail: it is shown to the owner as data, never run.
	deny(name, category, detail) {
		this.denied++;
		this.write({ kind: 'denied', name, category: CATEGORIES.includes(category) ? category : 'other', detail: oneLine(detail, 200) });
	}
	limit(window, utilization, resetsAt, status) {
		this.write({ kind: 'limit', window, utilization, resets_at: resetsAt || null, status });
	}
	result(status, turns, text) {
		if (!this.started) this.start(this.backend || 'unknown', null);
		for (const id of [...this.open.keys()]) this.toolEnd(id, status === 'success');
		this.write({ kind: 'result', status, turns: turns ?? null, tools: this.tools, denied: this.denied, text: oneLine(text || '', 2000, true) });
	}
	close() { fs.closeSync(this.fd); }
}

function oneLine(s, max, keepNewlines) {
	s = String(s ?? '');
	if (!keepNewlines) s = s.replace(/\s+/g, ' ');
	return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function writeUsage(out, usage) {
	fs.writeFileSync(path.join(out, 'usage.json'), JSON.stringify(usage, null, 1) + '\n', { mode: 0o640 });
}

// Read a JSON-lines stream, calling fn for every parsed object (bad lines are ignored).
function lines(stream, fn) {
	let buf = '';
	stream.setEncoding('utf8');
	stream.on('data', d => {
		buf += d;
		let i;
		while ((i = buf.indexOf('\n')) >= 0) {
			const line = buf.slice(0, i);
			buf = buf.slice(i + 1);
			if (!line.trim()) continue;
			let obj;
			try { obj = JSON.parse(line); } catch { continue; }
			fn(obj, line);
		}
	});
}

// Spawn the backend CLI in its own process group, tee stdout to raw.jsonl and stderr to
// stderr.txt, feed every JSON line to onObj, and kill the whole group after `timeout` seconds.
function spawnBackend(cmd, args, { cwd, env, timeout, out, onObj, stdin }) {
	const { spawn } = require('node:child_process');
	return new Promise(resolve => {
		const raw = fs.createWriteStream(path.join(out, 'raw.jsonl'), { mode: 0o600 });
		const err = fs.createWriteStream(path.join(out, 'stderr.txt'), { mode: 0o600 });
		let child;
		try {
			child = spawn(cmd, args, { cwd, env, detached: true, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
		} catch (e) {
			resolve({ code: 127, timedOut: false, error: e.message });
			return;
		}
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			try { process.kill(-child.pid, 'SIGTERM'); } catch {}
			setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 10000).unref();
		}, timeout * 1000);
		child.stdout.on('data', d => raw.write(d));
		child.stderr.pipe(err);
		lines(child.stdout, onObj);
		if (stdin) { child.stdin.end(stdin); }
		child.on('error', e => { clearTimeout(timer); raw.end(); err.end(); resolve({ code: 127, timedOut, error: e.message }); });
		child.on('close', code => { clearTimeout(timer); raw.end(); err.end(); resolve({ code: code ?? 1, timedOut }); });
	});
}

module.exports = { Transcript, writeUsage, lines, oneLine, spawnBackend, CATEGORIES };
