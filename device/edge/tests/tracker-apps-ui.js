// Logic test of public/apps.js (issue 477) with a minimal DOM: buttons per state, one request per tap, button disabled after a tap.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const mkEl = tag => ({ tag, className: '', textContent: '', children: [], dataset: {}, disabled: false, handlers: {},
  append(...c) { this.children.push(...c); }, replaceChildren() { this.children = []; }, addEventListener(e, f) { this.handlers[e] = f; } });
const box = mkEl('div'), msg = mkEl('p');
const posts = [];
const apps = [{ app: 'a', off: '', always: false, new: false }, { app: 'b', off: '2026-11-01', always: false, new: false },
  { app: 'c', off: '2026-11-10', always: false, new: true }, { app: 'd', off: '', always: true, new: false }];
const sandbox = {
  document: { getElementById: id => (id === 'apps-list' ? box : msg), createElement: mkEl },
  fetch: async (u, o) => { if (o && o.method === 'POST') { posts.push(JSON.parse(o.body)); return { ok: true }; } return { ok: true, json: async () => ({ apps }) }; },
  setInterval: () => 0, clearInterval: () => {},
};
const all = n => [n, ...n.children.flatMap(all)];
(async () => {
  new Function(...Object.keys(sandbox), fs.readFileSync(path.join(__dirname, '..', 'tracker', 'public', 'apps.js'), 'utf8'))(...Object.values(sandbox));
  await new Promise(r => setTimeout(r, 20));
  const labels = Object.fromEntries(box.children.map(r => [r.dataset.app, all(r).filter(n => n.tag === 'button').map(b => b.textContent)]));
  assert.deepEqual(labels, { a: ['Sempre accesa'], b: ['Riaccendi'], c: ['Prova'], d: ['Togli sempre accesa'] });
  const text = r => all(r).map(n => n.textContent).join(' ');
  assert.ok(/spenta perché non usata dal 01\/11/.test(text(box.children[1])));
  assert.ok(/nuova/.test(text(box.children[2])));
  const btn = all(box.children[2]).find(n => n.tag === 'button');
  await btn.handlers.click();
  assert.deepEqual(posts, [{ app: 'c', action: 'trial' }]);
  assert.equal(btn.disabled, true, 'button disabled after the tap');
  console.log('ok tracker-apps-ui');
})().catch(e => { console.error(e); process.exit(1); });
