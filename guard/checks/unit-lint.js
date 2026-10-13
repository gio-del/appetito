#!/usr/bin/env node
'use strict';
// unit-lint: validates the systemd units the agent may write (core/systemd/, services/*/) before
// the deploy runner installs them as root. Allowlist, not denylist: any key not listed here is
// refused, because many systemd options act as root before the service drops privileges
// (LoadCredential=, StandardOutput=file:, EnvironmentFile=, ExecStart=+…, Requires=poweroff.target…).
//
//   unit-lint REPO_DIR        lint every unit; prints one line per problem; exit 1 if any
//   unit-lint --json REPO_DIR prints {units:[{file,name,user,kind,service}], errors:[…]}
//
// Who a unit may run as:
//   core/systemd/<unit>          the user given for it in guard/units.allow (never root)
//   services/<name>/<unit>       the service's USER from services/<name>/service.env; unit names
//                                must be <name>.<type> or <name>-<anything>.<type>
const fs = require('node:fs');
const path = require('node:path');

const SAFE_TARGETS = new Set(['network.target', 'network-online.target', 'time-sync.target', 'local-fs.target',
	'remote-fs.target', 'nss-lookup.target', 'multi-user.target', 'timers.target', 'default.target', 'sysinit.target']);
const BOOL = /^(yes|no|true|false|on|off|1|0)$/;
const ANY = () => true;

// [Unit]
const UNIT = {
	Description: ANY, Documentation: ANY,
	After: 'deps', Before: 'deps', Wants: 'deps', Requires: 'deps', PartOf: 'deps', BindsTo: 'deps',
	StartLimitIntervalSec: ANY, StartLimitBurst: ANY,
	ConditionPathExists: ANY, ConditionPathIsDirectory: ANY, ConditionFileNotEmpty: ANY,
};
const SERVICE = {
	Type: v => /^(simple|exec|forking|oneshot|notify|idle)$/.test(v),
	ExecStart: 'exec', ExecStartPre: 'exec', ExecStartPost: 'exec', ExecStop: 'exec', ExecStopPost: 'exec', ExecReload: 'exec', ExecCondition: 'exec',
	User: 'user', Group: 'group',
	Environment: ANY, EnvironmentFile: 'envfile', WorkingDirectory: v => /^-?(\/|~$)/.test(v) && !v.includes('..'),
	StateDirectory: 'dir', CacheDirectory: 'dir', RuntimeDirectory: 'dir', LogsDirectory: 'dir', ConfigurationDirectory: 'dir',
	StateDirectoryMode: /^0?[0-7]{3}$/, RuntimeDirectoryMode: /^0?[0-7]{3}$/, LogsDirectoryMode: /^0?[0-7]{3}$/,
	Restart: /^(no|always|on-success|on-failure|on-abnormal|on-abort|on-watchdog)$/, RestartSec: ANY,
	TimeoutSec: ANY, TimeoutStartSec: ANY, TimeoutStopSec: ANY, RuntimeMaxSec: ANY, WatchdogSec: ANY,
	RemainAfterExit: BOOL, SuccessExitStatus: ANY, KillMode: /^(control-group|mixed|process)$/, KillSignal: ANY,
	NoNewPrivileges: 'nnp',
	AmbientCapabilities: 'caps', CapabilityBoundingSet: 'caps',
	StandardOutput: /^(journal|null|inherit|journal\+console)$/, StandardError: /^(journal|null|inherit|journal\+console)$/,
	SyslogIdentifier: ANY, UMask: /^0?[0-7]{3,4}$/, Nice: /^-?\d+$/, IOSchedulingClass: ANY,
	MemoryMax: ANY, MemoryHigh: ANY, CPUQuota: ANY, CPUWeight: ANY, TasksMax: ANY, LimitNOFILE: ANY,
	OOMScoreAdjust: /^\d+$/, // only make it more likely to be killed
	ReadWritePaths: ANY, ReadOnlyPaths: ANY, InaccessiblePaths: ANY, TemporaryFileSystem: ANY,
	PrivateTmp: BOOL, PrivateDevices: BOOL, PrivateUsers: BOOL, PrivateIPC: BOOL, PrivateNetwork: BOOL,
	ProtectSystem: /^(yes|no|full|strict|true|false)$/, ProtectHome: /^(yes|no|read-only|tmpfs|true|false)$/,
	ProtectKernelTunables: BOOL, ProtectKernelModules: BOOL, ProtectKernelLogs: BOOL, ProtectControlGroups: BOOL,
	ProtectClock: BOOL, ProtectHostname: BOOL, ProtectProc: ANY, ProcSubset: ANY,
	RestrictNamespaces: ANY, RestrictRealtime: BOOL, RestrictSUIDSGID: BOOL, RestrictAddressFamilies: ANY,
	LockPersonality: BOOL, MemoryDenyWriteExecute: BOOL, SystemCallFilter: ANY, SystemCallArchitectures: ANY,
	SystemCallErrorNumber: ANY, RemoveIPC: BOOL, KeyringMode: /^(private|shared)$/, DevicePolicy: ANY,
	IPAddressDeny: ANY, IPAddressAllow: ANY,
};
const TIMER = {
	OnCalendar: ANY, OnBootSec: ANY, OnStartupSec: ANY, OnActiveSec: ANY, OnUnitActiveSec: ANY, OnUnitInactiveSec: ANY,
	RandomizedDelaySec: ANY, AccuracySec: ANY, Persistent: BOOL, FixedRandomDelay: BOOL, Unit: 'sameunit',
};
const PATH = { PathChanged: ANY, PathModified: ANY, PathExists: ANY, DirectoryNotEmpty: ANY, Unit: 'sameunit', MakeDirectory: /^no$/ };
const INSTALL = { WantedBy: v => v.split(/\s+/).every(t => ['multi-user.target', 'timers.target', 'default.target', 'paths.target'].includes(t)), Also: 'deps' };
const SECTIONS = {
	service: { Unit: UNIT, Service: SERVICE, Install: INSTALL },
	timer: { Unit: UNIT, Timer: TIMER, Install: INSTALL },
	path: { Unit: UNIT, Path: PATH, Install: INSTALL },
};

function parseUnit(text) {
	const out = []; // [{section, key, value, line}]
	let section = null;
	const lines = text.replace(/\\\n/g, ' ').split('\n');
	lines.forEach((raw, i) => {
		const l = raw.trim();
		if (!l || l.startsWith('#') || l.startsWith(';')) return;
		const s = l.match(/^\[([A-Za-z]+)\]$/);
		if (s) { section = s[1]; return; }
		const m = l.match(/^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.*)$/);
		out.push(m ? { section, key: m[1], value: m[2], line: i + 1 } : { section, bad: l, line: i + 1 });
	});
	return out;
}

// KEY=VALUE manifest, never sourced by a shell.
function parseManifest(file) {
	const m = {};
	for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
		const l = raw.trim();
		if (!l || l.startsWith('#')) continue;
		const x = l.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
		if (!x) throw new Error(`bad line: ${l}`);
		let v = x[2];
		const q = v.match(/^"([^"$`\\]*)"$/) || v.match(/^'([^']*)'$/);
		if (q) v = q[1];
		else if (/[\s"'$`\\;|&<>]/.test(v)) throw new Error(`${x[1]}: quote values with spaces, no shell syntax`);
		m[x[1]] = v;
	}
	return m;
}

function loadAllow(repo) {
	const f = path.join(repo, 'guard', 'units.allow');
	const map = {};
	if (!fs.existsSync(f)) return map;
	for (const raw of fs.readFileSync(f, 'utf8').split('\n')) {
		const l = raw.replace(/#.*/, '').trim();
		if (!l) continue;
		const [unit, user, ...flags] = l.split(/\s+/);
		map[unit] = { user, flags };
	}
	return map;
}

const NAME_RE = /^[a-z][a-z0-9-]{1,30}$/;
const RESERVED = new Set(['root', 'agent', 'brain', 'tracker', 'appetito', 'nobody', 'daemon', 'bin', 'sys', 'sync', 'www-data', 'systemd', 'messagebus', 'sshd', 'syslog', 'backup', 'mail', 'man', 'news', 'proxy', 'list', 'irc', 'games', 'lp', 'uucp', 'nogroup', 'staff', 'sudo', 'adm', 'shadow', 'disk', 'docker', 'lxd', 'tty', 'kmem', 'wheel', 'users']);

function lintRepo(repo) {
	const errors = [];
	const units = [];
	const allow = loadAllow(repo);
	const err = (file, line, msg) => errors.push(`${file}${line ? ':' + line : ''}: ${msg}`);

	const candidates = []; // {file, name, kind, user, service, lowPort}
	const coreDir = path.join(repo, 'core', 'systemd');
	if (fs.existsSync(coreDir)) {
		for (const f of fs.readdirSync(coreDir).sort()) {
			const rel = `core/systemd/${f}`;
			if (!/\.(service|timer|path)$/.test(f)) { if (!f.startsWith('.') && f !== 'README.md') err(rel, 0, 'only .service, .timer and .path units are allowed'); continue; }
			if (!/^appetito-[a-z0-9-]+\.(service|timer|path)$/.test(f)) { err(rel, 0, 'core units are named appetito-<name>.<type>'); continue; }
			const a = allow[f.replace(/\.(timer|path)$/, '.service')];
			if (!a) { err(rel, 0, 'not listed in guard/units.allow'); continue; }
			candidates.push({ file: rel, name: f, kind: 'core', user: a.user, lowPort: false });
		}
	}
	const svcDir = path.join(repo, 'services');
	if (fs.existsSync(svcDir)) {
		for (const name of fs.readdirSync(svcDir).sort()) {
			const dir = path.join(svcDir, name);
			if (!fs.statSync(dir).isDirectory()) continue;
			const rel = `services/${name}`;
			if (!NAME_RE.test(name)) { err(rel, 0, 'service names are lowercase letters, digits and dashes'); continue; }
			const mf = path.join(dir, 'service.env');
			if (!fs.existsSync(mf)) { err(rel, 0, 'missing service.env'); continue; }
			let m;
			try { m = parseManifest(mf); } catch (e) { err(`${rel}/service.env`, 0, e.message); continue; }
			const user = m.USER || name;
			if (m.NAME && m.NAME !== name) err(`${rel}/service.env`, 0, 'NAME must match the folder name');
			if (!NAME_RE.test(user) || RESERVED.has(user) || RESERVED.has(name)) { err(`${rel}/service.env`, 0, `user ${user} is reserved or invalid`); continue; }
			for (const p of (m.APT || '').split(/\s+/).filter(Boolean))
				if (!/^[a-z0-9][a-z0-9+.-]+$/.test(p)) err(`${rel}/service.env`, 0, `bad package name ${p}`);
			for (const p of (m.PORTS || '').split(/\s+/).filter(Boolean))
				if (!/^(127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\[::\]|\*):\d{1,5}(\/(tcp|udp))?$/.test(p)) err(`${rel}/service.env`, 0, `bad port ${p}`);
			if (m.LOW_PORT && !/^(yes|no)$/.test(m.LOW_PORT)) err(`${rel}/service.env`, 0, 'LOW_PORT is yes or no');
			for (const f of fs.readdirSync(dir).sort()) {
				if (!/\.(service|timer|path|socket|mount|target)$/.test(f)) continue;
				const urel = `${rel}/${f}`;
				if (!/\.(service|timer|path)$/.test(f)) { err(urel, 0, 'only .service, .timer and .path units are allowed'); continue; }
				const base = f.replace(/\.(service|timer|path)$/, '');
				if (base !== name && !base.startsWith(name + '-')) { err(urel, 0, `unit names start with the service name (${name})`); continue; }
				candidates.push({ file: urel, name: f, kind: 'service', service: name, user, lowPort: m.LOW_PORT === 'yes' });
			}
		}
	}
	const names = new Set(candidates.map(c => c.name));
	// guard's own units may be ordered against (After=/Before=), never pulled in.
	const guardUnits = new Set();
	try { for (const f of fs.readdirSync(path.join(repo, 'guard', 'systemd'))) guardUnits.add(f); } catch {}
	const seen = new Set();
	for (const c of candidates) {
		if (seen.has(c.name)) { err(c.file, 0, 'unit name used twice'); continue; }
		seen.add(c.name);
		const type = c.name.split('.').pop();
		const allowed = SECTIONS[type];
		const text = fs.readFileSync(path.join(repo, c.file), 'utf8');
		const entries = parseUnit(text);
		let user = null, nnp = false, hasExec = false;
		for (const e of entries) {
			if (e.bad) { err(c.file, e.line, `unparseable line: ${e.bad}`); continue; }
			if (!e.section || !allowed[e.section]) { err(c.file, e.line, `section [${e.section}] not allowed in a .${type}`); continue; }
			const rule = allowed[e.section][e.key];
			if (!rule) { err(c.file, e.line, `${e.key}= is not on the allowlist`); continue; }
			const v = e.value.trim();
			const bad = msg => err(c.file, e.line, `${e.key}=${v}: ${msg}`);
			if (rule === ANY) continue;
			if (rule instanceof RegExp) { if (!rule.test(v)) bad('value not allowed'); continue; }
			if (typeof rule === 'function') { if (!rule(v)) bad('value not allowed'); continue; }
			switch (rule) {
			case 'deps':
				for (const t of v.split(/\s+/).filter(Boolean))
					if (!SAFE_TARGETS.has(t) && !names.has(t) && !(guardUnits.has(t) && (e.key === 'After' || e.key === 'Before')))
						bad(`${t} is not a safe target or one of this repo's units`);
				break;
			case 'exec':
				hasExec = true;
				// Prefixes + ! !! run (parts of) the command with full privileges: never.
				if (/^[-@:]*[+!]/.test(v)) bad('the + and ! prefixes run as root');
				break;
			case 'user':
				user = v;
				if (v !== c.user) bad(`must be User=${c.user}`);
				break;
			case 'group':
				if (v !== c.user) bad(`Group= must be the unit's own user (${c.user})`);
				break;
			case 'envfile': {
				const p = v.replace(/^-/, '');
				const ok = p === '/etc/appetito/appetito.env' || p === '/var/lib/appetito/settings.env' ||
					(c.kind === 'service' && p.startsWith(`/etc/appetito/services/${c.service}/`) && !p.includes('..'));
				if (!ok) bad('only /etc/appetito/appetito.env, /var/lib/appetito/settings.env or /etc/appetito/services/<name>/…');
				break;
			}
			case 'dir': {
				const own = c.kind === 'service' ? c.service : c.user;
				for (const d of v.split(/\s+/)) if (d !== own && !d.startsWith(own + '/')) bad(`must be ${own} or under it (systemd chowns it as root)`);
				break;
			}
			case 'nnp': nnp = /^(yes|true|on|1)$/.test(v); break;
			case 'caps':
				if (v === '' || v === '~') break;
				if (!(c.lowPort && v === 'CAP_NET_BIND_SERVICE')) bad(c.lowPort ? 'only CAP_NET_BIND_SERVICE' : 'no capabilities (set LOW_PORT=yes in service.env for CAP_NET_BIND_SERVICE)');
				break;
			case 'sameunit': {
				const want = c.name.replace(/\.(timer|path)$/, '.service');
				if (v !== want) bad(`must be ${want}`);
				break;
			}
			}
		}
		if (type === 'service') {
			if (!hasExec) err(c.file, 0, 'no ExecStart=');
			if (!user) err(c.file, 0, `User=${c.user} is required`);
			if (!nnp) err(c.file, 0, 'NoNewPrivileges=yes is required');
		} else if (!names.has(c.name.replace(/\.(timer|path)$/, '.service'))) err(c.file, 0, 'no matching .service');
		units.push({ file: c.file, name: c.name, user: c.user, kind: c.kind, service: c.service || null });
	}
	return { units, errors };
}

module.exports = { lintRepo, parseManifest, parseUnit };

if (require.main === module) {
	const args = process.argv.slice(2);
	const json = args[0] === '--json';
	const repo = path.resolve(json ? args[1] : args[0] || '.');
	const r = lintRepo(repo);
	if (json) console.log(JSON.stringify(r));
	else { for (const e of r.errors) console.log(e); if (!r.errors.length) console.log(`unit-lint: ${r.units.length} units ok`); }
	process.exit(r.errors.length ? 1 : 0);
}
