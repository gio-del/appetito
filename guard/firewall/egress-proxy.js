#!/usr/bin/env node
'use strict';
// egress-proxy: the only way out for the users agent and brain (nftables lets them reach loopback
// only, see appetito-fw). An HTTP proxy that allows CONNECT (and plain-HTTP requests) only to the
// host names in the allowlists, so a CDN changing addresses never breaks it. Runs as its own
// user (appetito-egress). One allowlist per client user, chosen by the client's uid (looked up
// from the socket's owner in /proc/net/tcp), so brain can't use agent's list.
//
// Env: EGRESS_PORT (3128), EGRESS_LISTS (dir with <user>.allow; default /opt/appetito/current/guard/firewall),
//      EGRESS_EXTRA (dir with <user>.allow added by the owner; default /etc/appetito/firewall.d),
//      EGRESS_LOG (file; default stdout).
// Allowlist lines: `example.com` (exactly), `*.example.com` (any subdomain), `#` comments.
// Ports: 443 for CONNECT, 80 for plain HTTP.
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PORT = Number(process.env.EGRESS_PORT || 3128);
const LISTS = process.env.EGRESS_LISTS || '/opt/appetito/current/guard/firewall';
const EXTRA = process.env.EGRESS_EXTRA || '/etc/appetito/firewall.d';
const LOG = process.env.EGRESS_LOG;

function log(line) {
	const s = `${new Date().toISOString()} ${line}\n`;
	if (LOG) fs.appendFile(LOG, s, () => {}); else process.stdout.write(s);
}

let lists = {}, loaded = 0;
function loadLists() {
	if (Date.now() - loaded < 30000) return;
	loaded = Date.now();
	const next = {};
	for (const dir of [LISTS, EXTRA]) {
		let files = [];
		try { files = fs.readdirSync(dir).filter(f => /^[a-z][a-z0-9-]*\.allow$/.test(f)); } catch { continue; }
		for (const f of files) {
			const user = f.replace(/\.allow$/, '');
			const set = next[user] || (next[user] = { exact: new Set(), suffix: [] });
			for (const raw of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
				const l = raw.replace(/#.*/, '').trim().toLowerCase();
				if (!l) continue;
				if (l.startsWith('*.')) set.suffix.push(l.slice(1)); else set.exact.add(l);
			}
		}
	}
	lists = next;
}

function allowed(user, host) {
	loadLists();
	const l = lists[user];
	if (!l) return false;
	host = host.toLowerCase().replace(/\.$/, '');
	if (!/^[a-z0-9.-]+$/.test(host)) return false; // no IP literals with colons, no odd names
	return l.exact.has(host) || l.suffix.some(s => host.endsWith(s));
}

// uid of the local client socket: find our accepted socket in /proc/net/tcp{,6} by its ports.
const uidCache = new Map();
function clientUser(sock) {
	const rport = sock.remotePort, lport = sock.localPort;
	for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
		let t;
		try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
		for (const line of t.split('\n').slice(1)) {
			const c = line.trim().split(/\s+/);
			if (c.length < 8) continue;
			const local = parseInt(c[1].split(':')[1], 16), remote = parseInt(c[2].split(':')[1], 16);
			// The client's socket: its local port is our remote port, its remote is our listen port.
			if (local === rport && remote === lport) return userName(Number(c[7]));
		}
	}
	return null;
}
function userName(uid) {
	if (uidCache.has(uid)) return uidCache.get(uid);
	let name = null;
	try { name = execFileSync('id', ['-nu', String(uid)], { encoding: 'utf8' }).trim(); } catch {}
	uidCache.set(uid, name);
	return name;
}

const server = http.createServer((req, res) => {
	// Plain HTTP through the proxy: absolute URI, port 80 only.
	let u;
	try { u = new URL(req.url); } catch { res.writeHead(400).end(); return; }
	const user = clientUser(req.socket);
	if (u.protocol !== 'http:' || (u.port && u.port !== '80') || !allowed(user, u.hostname)) {
		log(`deny ${user} http ${u.hostname}`);
		res.writeHead(403, { 'content-type': 'text/plain' }).end(`appetito egress: ${u.hostname} is not on the allowlist for ${user}\n`);
		return;
	}
	log(`allow ${user} http ${u.hostname}`);
	const up = http.request({ host: u.hostname, port: 80, path: u.pathname + u.search, method: req.method, headers: req.headers }, r => {
		res.writeHead(r.statusCode, r.headers);
		r.pipe(res);
	});
	up.on('error', () => { try { res.writeHead(502).end(); } catch {} });
	req.pipe(up);
});

server.on('connect', (req, sock, head) => {
	const m = /^([^:\s]+):(\d+)$/.exec(req.url || '');
	const user = clientUser(sock);
	if (!m || m[2] !== '443' || !allowed(user, m[1])) {
		log(`deny ${user} connect ${req.url}`);
		sock.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\nappetito egress: ${req.url} is not on the allowlist for ${user}\n`);
		return;
	}
	log(`allow ${user} connect ${m[1]}`);
	const up = net.connect(443, m[1], () => {
		sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
		if (head && head.length) up.write(head);
		up.pipe(sock); sock.pipe(up);
	});
	up.setTimeout(600000, () => up.destroy());
	up.on('error', () => sock.destroy());
	sock.on('error', () => up.destroy());
});

server.listen(PORT, '127.0.0.1', () => log(`egress-proxy on 127.0.0.1:${PORT}`));
module.exports = { allowed };
