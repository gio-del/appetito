'use strict';
// forward.js: lets the PC's browser reach services that listen on an e2e box's loopback only (the
// tracker, a service the agent added), like `kubectl port-forward`: it listens on the PC and opens a
// `docker exec -i` per connection that connects to 127.0.0.1:PORT from inside the box. Nothing
// listens in the box, so the box's own checks (security-audit: no listener beyond loopback) still
// see exactly what a real server has. Used by the video scenario.
//   node forward.js BOX 18080:8080 18081:8081 18222:8222    (PC 127.0.0.1:FROM → box 127.0.0.1:TO)
const net = require('node:net');
const { spawn } = require('node:child_process');
const [box, ...pairs] = process.argv.slice(2);
const pipe = `const s=require('net').connect(+process.argv[1],'127.0.0.1');process.stdin.pipe(s);s.pipe(process.stdout);s.on('error',()=>process.exit(1));s.on('close',()=>process.exit(0));`;
for (const pair of pairs) {
	const [from, to] = pair.split(':').map(Number);
	net.createServer(c => {
		const p = spawn('docker', ['exec', '-i', box, 'node', '-e', pipe, String(to)], { stdio: ['pipe', 'pipe', 'ignore'] });
		c.pipe(p.stdin); p.stdout.pipe(c);
		c.on('error', () => p.kill()); c.on('close', () => p.kill());
		p.on('exit', () => c.destroy()); p.stdin.on('error', () => {});
	}).listen(from, '127.0.0.1');
}
