'use strict';
// Records the launch video's footage: a phone-sized browser (Playwright, Chromium) driving the real
// tracker of an e2e box while the worker closes "Add Vaultwarden". A real run, not a replay.
// Output: out/footage/*.webm (one per phase) + out/footage/marks.json (when things happened), which
// the Remotion composition time-lapses.
//
//   node record.js --main http://127.0.0.1:18080 --confirm http://127.0.0.1:18081 --setup TOKEN
//                  [--issue 001] [--app http://127.0.0.1:18222] [--timeout 3600]
const { chromium, devices } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MAIN = arg('main'), CONF = arg('confirm'), SETUP = arg('setup'), ISSUE = arg('issue', '001');
const APP = arg('app', ''), TIMEOUT = Number(arg('timeout', '3600'));
const OUT = path.join(__dirname, 'out', 'footage');
fs.mkdirSync(OUT, { recursive: true });
const marks = { t0: Date.now(), events: [] };
const mark = (name, extra = {}) => { marks.events.push({ name, t: Date.now() - marks.t0, ...extra }); fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 1)); console.log(`${((Date.now() - marks.t0) / 1000).toFixed(1)}s ${name}`); };
const PW = 'video-password-not-secret-1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
	const browser = await chromium.launch();
	const phone = devices['Pixel 7'];
	const ctx = await browser.newContext({ ...phone, deviceScaleFactor: 3, colorScheme: 'dark', locale: 'en-GB',
		recordVideo: { dir: OUT, size: { width: 1080, height: Math.round(1080 * phone.viewport.height / phone.viewport.width) } } });
	const page = await ctx.newPage();
	// Sign in once (setup link), off camera time-wise: the composition cuts it.
	await page.goto(`${CONF}/setup?token=${SETUP}`);
	await page.fill('input[name=password]', PW);
	await page.fill('input[name=password2]', PW);
	await Promise.all([page.waitForURL(`${MAIN}/**`), page.click('button[type=submit]')]);
	await page.waitForSelector('#tabs button');
	mark('board');
	// Backlog tab, the starter issue.
	await page.click('#tabs button:nth-child(2)');
	await sleep(1500);
	mark('backlog');
	await page.click(`.col.active .card[data-id="${ISSUE}"]`);
	await page.waitForSelector('#d-title');
	await sleep(2000);
	mark('drawer');
	// Status → To do.
	await page.selectOption('.props select >> nth=0', 'todo');
	await sleep(1500);
	mark('moved');
	await page.click('.auto-go');
	await sleep(1500);
	mark('started');
	// The live page for the whole run.
	await page.goto(`${MAIN}/auto.html`);
	await page.waitForSelector('.au-hero');
	mark('live');
	const end = Date.now() + TIMEOUT * 1000;
	let closed = false;
	while (Date.now() < end) {
		const st = await page.evaluate(async () => (await (await fetch('/api/auto')).json()).status);
		const r = await page.evaluate(async id => { const x = await (await fetch(`/api/issues/${id}`)).json(); return { state: x.state, column: x.column }; }, ISSUE);
		if (st && st.code === 'deploying' && !marks.events.some(e => e.name === 'deploying')) mark('deploying');
		if (r.state === 'done') { closed = true; break; }
		await sleep(5000);
	}
	mark(closed ? 'closed' : 'timeout');
	await sleep(4000);
	// Back to the board: the issue in Done.
	await page.goto(`${MAIN}/?tab=done`);
	await page.waitForSelector(`.col.active .card[data-id="${ISSUE}"]`);
	await sleep(1500);
	await page.click(`.col.active .card[data-id="${ISSUE}"]`);
	await page.waitForSelector('#d-title');
	await sleep(3000);
	mark('done-drawer');
	if (APP && closed) {
		await page.goto(APP);
		await sleep(5000);
		mark('app');
	}
	await ctx.close();
	await browser.close();
	const vids = fs.readdirSync(OUT).filter(f => f.endsWith('.webm'));
	marks.video = vids[vids.length - 1];
	fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 1));
	console.log(`video: ${marks.video}`);
	process.exit(closed ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
