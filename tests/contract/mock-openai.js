#!/usr/bin/env node
'use strict';
// A scripted OpenAI-compatible endpoint for the `openai` adapter's contract test: deterministic,
// no model needed. It answers the hello.txt task with one `write` tool call, then "done"; a
// prompt asking to count slowly streams forever (for the timeout test).
//   node mock-openai.js PORT
const http = require('node:http');
const port = Number(process.argv[2] || 18080);

function chunk(res, delta, finish, usage) {
	const o = { id: 'mock', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock',
		choices: [{ index: 0, delta, finish_reason: finish || null }] };
	if (usage) o.usage = usage;
	res.write(`data: ${JSON.stringify(o)}\n\n`);
}

http.createServer((req, res) => {
	if (req.method === 'GET' && req.url.endsWith('/models')) {
		res.setHeader('content-type', 'application/json');
		res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock', object: 'model', owned_by: 'mock' }] }));
		return;
	}
	let body = '';
	req.on('data', d => { body += d; });
	req.on('end', () => {
		let j = {};
		try { j = JSON.parse(body); } catch {}
		const msgs = j.messages || [];
		const user = msgs.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || '').join('')).join('\n');
		const toolDone = msgs.some(m => m.role === 'tool');
		const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
		// opencode asks for a session title with a separate small request: answer plainly.
		const isTitle = msgs.some(m => m.role === 'system' && /title/i.test(typeof m.content === 'string' ? m.content : '')) && !(j.tools || []).length;
		const tools = (j.tools || []).map(t => t.function?.name);
		if (process.env.MOCK_DEBUG) console.error('tools:', tools.join(','));
		res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
		if (isTitle) { chunk(res, { role: 'assistant', content: 'Mock task' }); chunk(res, {}, 'stop', usage); res.end('data: [DONE]\n\n'); return; }
		if (/count slowly/i.test(user)) {
			chunk(res, { role: 'assistant', content: '' });
			let i = 0;
			const t = setInterval(() => { chunk(res, { content: `${++i}\n` }); }, 200);
			req.on('close', () => clearInterval(t));
			res.on('close', () => clearInterval(t));
			return;
		}
		if (/hello\.txt/.test(user) && !toolDone && tools.includes('write')) {
			chunk(res, { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write', arguments: '' } }] });
			chunk(res, { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ filePath: 'hello.txt', content: 'hi' }) } }] });
			chunk(res, {}, 'tool_calls', usage);
			res.end('data: [DONE]\n\n');
			return;
		}
		chunk(res, { role: 'assistant', content: 'done' });
		chunk(res, {}, 'stop', usage);
		res.end('data: [DONE]\n\n');
	});
}).listen(port, '127.0.0.1', () => console.error(`mock-openai on 127.0.0.1:${port}`));
