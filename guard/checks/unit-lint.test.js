'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lintRepo } = require('./unit-lint.js');

function repo(files) {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-lint-'));
	for (const [f, c] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
		fs.writeFileSync(path.join(d, f), c);
	}
	return d;
}
const ALLOW = { 'guard/units.allow': 'appetito-worker.service agent\n' };
const svc = (extra = '', user = 'demo') => `[Unit]\nDescription=d\nAfter=network-online.target\n[Service]\nUser=${user}\nNoNewPrivileges=yes\nExecStart=/usr/bin/true\n${extra}\n[Install]\nWantedBy=multi-user.target\n`;
const demo = (unit, manifest = 'NAME=demo\nPORTS=127.0.0.1:8080\n') => repo({ ...ALLOW, 'services/demo/service.env': manifest, 'services/demo/demo.service': unit });
const errs = d => lintRepo(d).errors;

test('a well-formed service passes', () => assert.deepStrictEqual(errs(demo(svc())), []));
test('core unit runs as its allowed user', () => {
	assert.deepStrictEqual(errs(repo({ ...ALLOW, 'core/systemd/appetito-worker.service': svc('', 'agent') })), []);
	assert.match(errs(repo({ ...ALLOW, 'core/systemd/appetito-worker.service': svc('', 'root') })).join(), /must be User=agent/);
	assert.match(errs(repo({ ...ALLOW, 'core/systemd/appetito-evil.service': svc('', 'agent') })).join(), /units.allow/);
});
test('root and other users are refused', () => {
	assert.match(errs(demo(svc('', 'root'))).join(), /must be User=demo/);
	assert.match(errs(demo(svc().replace('User=demo\n', ''))).join(), /User=demo is required/);
	assert.match(errs(demo(svc('Group=shadow'))).join(), /Group=/);
	assert.match(errs(demo(svc(), 'NAME=demo\nUSER=root\n')).join(), /reserved/);
	assert.match(errs(demo(svc(), 'NAME=demo\nUSER=agent\n')).join(), /reserved/);
});
test('options that act as root are refused', () => {
	for (const [line, re] of [
		['ExecStartPre=+/bin/sh -c id', /run as root/],
		['ExecStartPre=-!/bin/sh', /run as root/],
		['LoadCredential=x:/etc/shadow', /allowlist/],
		['StandardOutput=file:/etc/passwd', /not allowed/],
		['EnvironmentFile=/etc/shadow', /only/],
		['StateDirectory=appetito', /must be demo/],
		['AmbientCapabilities=CAP_SYS_ADMIN', /no capabilities/],
		['SupplementaryGroups=sudo', /allowlist/],
		['PermissionsStartOnly=yes', /allowlist/],
		['DynamicUser=yes', /allowlist/],
		['OOMScoreAdjust=-1000', /not allowed/],
	]) assert.match(errs(demo(svc(line))).join(), re, line);
});
test('dependencies cannot pull in arbitrary units', () => {
	assert.match(errs(demo(svc().replace('After=network-online.target', 'Requires=poweroff.target'))).join(), /safe target/);
	assert.match(errs(demo(svc().replace('After=network-online.target', 'OnFailure=reboot.target'))).join(), /allowlist/);
	assert.match(errs(demo(svc().replace('After=network-online.target', 'Conflicts=ssh.service'))).join(), /allowlist/);
});
test('NoNewPrivileges is required', () => assert.match(errs(demo(svc().replace('NoNewPrivileges=yes\n', ''))).join(), /NoNewPrivileges/));
test('CAP_NET_BIND_SERVICE only with LOW_PORT=yes', () => {
	assert.deepStrictEqual(errs(demo(svc('AmbientCapabilities=CAP_NET_BIND_SERVICE\nCapabilityBoundingSet=CAP_NET_BIND_SERVICE'), 'NAME=demo\nLOW_PORT=yes\n')), []);
	assert.match(errs(demo(svc('AmbientCapabilities=CAP_NET_BIND_SERVICE'))).join(), /LOW_PORT/);
});
test('unit names are scoped to the service', () => {
	const d = repo({ ...ALLOW, 'services/demo/service.env': 'NAME=demo\n', 'services/demo/ssh.service': svc() });
	assert.match(errs(d).join(), /start with the service name/);
	const s = repo({ ...ALLOW, 'services/demo/service.env': 'NAME=demo\n', 'services/demo/demo.socket': '[Socket]\nListenStream=80\n' });
	assert.match(errs(s).join(), /only .service/);
});
test('timers must trigger their own service', () => {
	const ok = repo({ ...ALLOW, 'services/demo/service.env': 'NAME=demo\n', 'services/demo/demo-backup.service': svc(), 'services/demo/demo-backup.timer': '[Timer]\nOnCalendar=daily\n[Install]\nWantedBy=timers.target\n' });
	assert.deepStrictEqual(errs(ok), []);
	const bad = repo({ ...ALLOW, 'services/demo/service.env': 'NAME=demo\n', 'services/demo/demo-backup.service': svc(), 'services/demo/demo-backup.timer': '[Timer]\nOnCalendar=daily\nUnit=appetito-deploy.service\n' });
	assert.match(errs(bad).join(), /must be demo-backup.service/);
});
test('manifest values are not shell', () => {
	assert.match(errs(demo(svc(), 'NAME=demo\nAPT=$(id)\n')).join(), /shell syntax|bad package/);
	assert.match(errs(demo(svc(), 'NAME=demo\nAPT="ok; rm -rf /"\n')).join(), /bad package|shell syntax/);
	assert.match(errs(demo(svc(), 'NAME=demo\nPORTS=8080\n')).join(), /bad port/);
});
