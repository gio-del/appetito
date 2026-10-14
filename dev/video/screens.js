'use strict';
// Phone-width screenshots of the tracker in each UI language (dev issue 004's acceptance), from a
// throwaway tracker on this PC: a temp repo with the starter backlog, nothing of a real server.
//   node screens.js OUT_DIR
const { chromium, devices } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || 'out/screens');
const PW = 'screens-password-not-secret';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function hash(pw) {
	const s = crypto.randomBytes(16), N = 1024, r = 8, p = 1;
	return ['scrypt', N, r, p, s.toString('base64'), crypto.scryptSync(pw, s, 32, { N, r, p }).toString('base64')].join('$');
}

async function shoot(lang, port) {
	const T = fs.mkdtempSync(path.join(os.tmpdir(), 'screens-'));
	const REPO = path.join(T, 'repo'), STATE = path.join(T, 'state');
	fs.cpSync(path.join(ROOT, 'issues'), path.join(REPO, 'issues'), { recursive: true });
	execFileSync('git', ['init', '-q', REPO]);
	execFileSync('git', ['-C', REPO, '-c', 'user.name=x', '-c', 'user.email=x@x', 'add', '-A']);
	execFileSync('git', ['-C', REPO, '-c', 'user.name=x', '-c', 'user.email=x@x', 'commit', '-qm', 'Starter backlog']);
	fs.mkdirSync(STATE, { recursive: true });
	fs.writeFileSync(path.join(STATE, 'password'), hash(PW) + '\n');
	fs.writeFileSync(path.join(T, 'settings.env'), `APPETITO_UI_LANG=${lang}\n`);
	const MAIN = `http://127.0.0.1:${port}`, CONF = `http://127.0.0.1:${port + 1}`;
	const srv = spawn(process.execPath, [path.join(ROOT, 'guard', 'tracker', 'server.js')], { stdio: 'ignore', env: { ...process.env,
		TRACKER_REPO: REPO, TRACKER_STATE: STATE, TRACKER_PORT: String(port), TRACKER_CONFIRM_PORT: String(port + 1), TRACKER_ORIGINS: MAIN,
		TRACKER_CONFIRM_ORIGINS: CONF, APPETITO_STATE: path.join(T, 'var'), TRACKER_SETTINGS: path.join(T, 'settings.env'),
		TRACKER_WORKER_STATUS: path.join(T, 'status.json'), TRACKER_WORKER_REQUEST: path.join(T, 'req.json'), TRACKER_DEPLOY: path.join(T, 'deploy'), TRACKER_REQUESTS: path.join(T, 'requests') } });
	try {
		for (let i = 0; i < 100; i++) { try { await fetch(`${MAIN}/healthz`); break; } catch { await sleep(100); } }
		const browser = await chromium.launch();
		const ctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark' });
		const page = await ctx.newPage();
		await page.goto(`${CONF}/login`);
		await page.fill('input[name=password]', PW);
		await Promise.all([page.waitForURL(`${MAIN}/**`), page.click('button[type=submit]')]);
		const snap = async name => { await sleep(800); await page.screenshot({ path: path.join(OUT, `${lang}-${name}.png`) }); };
		await page.goto(`${MAIN}/?tab=backlog`); await page.waitForSelector('.card'); await snap('board');
		await page.click('.col.active .card[data-id="001"]'); await page.waitForSelector('#d-title'); await snap('drawer');
		await page.goto(`${MAIN}/auto.html`); await page.waitForSelector('.au-hero'); await snap('worker');
		await page.goto(`${MAIN}/changes.html`); await snap('changes');
		await browser.close();
	} finally { srv.kill(); fs.rmSync(T, { recursive: true, force: true }); }
}

(async () => {
	fs.mkdirSync(OUT, { recursive: true });
	let port = 21000;
	for (const lang of ['en', 'it']) { await shoot(lang, port); port += 10; }
	console.log(`screens in ${OUT}: ${fs.readdirSync(OUT).join(' ')}`);
})().catch(e => { console.error(e); process.exit(1); });
