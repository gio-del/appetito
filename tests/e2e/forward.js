'use strict';
// forward.js: TCP forwards inside an e2e box, so the PC's browser can reach services that listen on
// the box's loopback only (the tracker, a service the agent added). Used by the video scenario.
//   node forward.js 18080:8080 18081:8081 18222:8222    (0.0.0.0:FROM → 127.0.0.1:TO)
const net = require('node:net');
for (const pair of process.argv.slice(2)) {
	const [from, to] = pair.split(':').map(Number);
	net.createServer(c => {
		const u = net.connect(to, '127.0.0.1');
		c.pipe(u); u.pipe(c);
		c.on('error', () => u.destroy()); u.on('error', () => c.destroy());
	}).listen(from, '0.0.0.0');
}
