'use strict';
// Records the launch video's footage: a phone-sized browser (Playwright, Chromium) driving the real
// tracker of an e2e box while the worker closes "Add Vaultwarden". A real run, not a replay.
// Output: out/footage/frames/*.jpg (the DevTools screencast: real phone resolution, a frame on every
// change) + frames.json (when each was shown) + marks.json (when things happened), all in ms since t0;
// the Remotion composition picks frames by time and time-lapses.
//
//   node record.js --main http://127.0.0.1:18080 --confirm http://127.0.0.1:18081 --setup TOKEN
//                  [--issue 001] [--app http://127.0.0.1:18222] [--timeout 3600] [--owner 'CMD'] [--tick 'CMD']
// --tick CMD starts the worker's next round when it sits idle (the e2e doesn't wait for :07/:37).
// When the agent hands the issue over (Blocked on: user, (HITL) steps), --owner CMD runs on the PC
// (the owner's part on the server; prints the owner's comment) and the phone ticks the steps,
// comments, moves the issue back to To do and starts it again: the owner's turn is part of the film.
const { chromium, devices } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MAIN = arg('main'), CONF = arg('confirm'), SETUP = arg('setup'), ISSUE = arg('issue', '001');
const APP = arg('app', ''), TIMEOUT = Number(arg('timeout', '3600')), OWNER = arg('owner', ''), TICK = arg('tick', '');
const { execSync } = require('node:child_process');
const OUT = path.join(__dirname, 'out', 'footage');
fs.mkdirSync(OUT, { recursive: true });
const marks = { t0: Date.now(), events: [] };
const mark = (name, extra = {}) => { marks.events.push({ name, t: Date.now() - marks.t0, ...extra }); fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 1)); console.log(`${((Date.now() - marks.t0) / 1000).toFixed(1)}s ${name}`); };
const PW = 'video-password-not-secret-1';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let goto; // navigate and restart the screencast (set once the browser is up)
// Disk: ~45 kB a frame. At most one every 33 ms while things happen, one a second while the worker
// only waits (quota, idle: the live page animates forever), and a hard cap.
let gap = 33;
const MAX_FRAMES = 12000;

// The owner's turn: open the handed-over issue, read "For you", do the server part, tick the
// (HITL) steps one by one, comment, move it back to To do and start it.
async function ownerTurn(page) {
	gap = 33;
	mark('handed');
	await goto(`${MAIN}/?tab=blocked`);
	await page.click(`.col.active .card[data-id="${ISSUE}"]`);
	await page.waitForSelector('#d-title');
	await sleep(2000);
	const forYou = page.locator('.md :is(h2, h3, h4)', { hasText: 'For you' }).last();
	if (await forYou.count()) { await forYou.scrollIntoViewIfNeeded(); await sleep(3000); }
	mark('for-you');
	const comment = execSync(OWNER, { encoding: 'utf8' }).trim();
	for (let i = 0; i < 10; i++) {
		const step = page.locator('li.task:not(.done)', { hasText: '(HITL)' }).first();
		if (!await step.count()) break;
		await step.scrollIntoViewIfNeeded();
		await step.locator('input[type=checkbox]').click();
		await sleep(1500);
	}
	mark('ticked');
	const box = page.locator('textarea').last();
	await box.scrollIntoViewIfNeeded();
	await box.pressSequentially(comment, { delay: 15 });
	await box.press('Control+Enter');
	await sleep(2000);
	mark('commented');
	await page.locator('#d-title').scrollIntoViewIfNeeded();
	await page.selectOption('.props select >> nth=0', 'todo');
	await sleep(1500);
	await page.click('.auto-go');
	await sleep(1500);
	mark('restarted');
}

(async () => {
	const browser = await chromium.launch();
	const phone = devices['Pixel 7'];
	const ctx = await browser.newContext({ ...phone, deviceScaleFactor: 3, colorScheme: 'dark', locale: 'en-GB' });
	const page = await ctx.newPage();
	// Screencast: Playwright's recordVideo is low-bitrate and unscaled; this gives JPEGs at the
	// phone's real resolution. Restarted after each navigation (a new origin is a new renderer).
	const FR = path.join(OUT, 'frames'); fs.mkdirSync(FR, { recursive: true });
	const frames = [];
	let cdp = null;
	// A new CDP session each time: a cross-origin navigation moves the page to a new renderer and
	// the old session's screencast silently stops.
	const cast = async () => {
		const old = cdp; cdp = null;
		if (old) await old.detach().catch(() => {});
		const s = await ctx.newCDPSession(page);
		s.on('Page.screencastFrame', ({ data, sessionId }) => {
			s.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
			const t = Date.now() - marks.t0;
			if (frames.length >= MAX_FRAMES || (frames.length && t - frames[frames.length - 1].t < gap)) return;
			const f = `f${String(frames.length).padStart(5, '0')}.jpg`;
			fs.writeFileSync(path.join(FR, f), Buffer.from(data, 'base64'));
			frames.push({ f, t });
		});
		await s.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1080, maxHeight: 2400 });
		cdp = s;
	};
	goto = async url => { await page.goto(url); await cast(); };
	await cast();
	// Sign in once (setup link), off camera time-wise: the composition cuts it.
	await goto(`${CONF}/setup?token=${SETUP}`);
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
	await goto(`${MAIN}/auto.html`);
	await page.waitForSelector('.au-hero');
	mark('live');
	const end = Date.now() + TIMEOUT * 1000;
	let closed = false, owned = false;
	while (Date.now() < end) {
		const st = await page.evaluate(async () => (await (await fetch('/api/auto')).json()).status);
		const r = await page.evaluate(async id => { const x = await (await fetch(`/api/issues/${id}`)).json(); return { state: x.state, column: x.column }; }, ISSUE);
		if (st && st.code === 'deploying' && !marks.events.some(e => e.name === 'deploying')) mark('deploying');
		gap = ['working', 'deploying'].includes(st?.code) ? 33 : 1000;
		// The worker timer's next slot (:07/:37), now: after a rollback the monitor issue is waiting.
		if (st?.code === 'idle' && TICK) { try { execSync(TICK); } catch {} }
		if (r.state === 'done') { closed = true; break; }
		if (r.column === 'blocked' && OWNER && !owned && !['working', 'deploying'].includes(st?.code)) {
			owned = true;
			await ownerTurn(page);
			await goto(`${MAIN}/auto.html`);
			await page.waitForSelector('.au-hero');
			mark('live-again');
		}
		await sleep(5000);
	}
	gap = 33;
	mark(closed ? 'closed' : 'timeout');
	await sleep(4000);
	// Back to the board: the issue in Done.
	await goto(`${MAIN}/?tab=done`);
	await page.waitForSelector(`.col.active .card[data-id="${ISSUE}"]`);
	await sleep(1500);
	await page.click(`.col.active .card[data-id="${ISSUE}"]`);
	await page.waitForSelector('#d-title');
	await sleep(3000);
	mark('done-drawer');
	if (APP && closed) {
		await goto(APP);
		await page.waitForSelector('input', { timeout: 60000 }).catch(() => {}); // the web vault's login form, not its spinner
		await sleep(800);
		mark('app');
		await sleep(4000);
		mark('app-end');
	}
	if (cdp) await cdp.send('Page.stopScreencast').catch(() => {});
	await ctx.close();
	await browser.close();
	fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames));
	console.log(`frames: ${frames.length}`);
	process.exit(closed ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
