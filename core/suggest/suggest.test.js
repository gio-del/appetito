'use strict';
const test = require('node:test');
const assert = require('node:assert');
process.env.APPETITO_SUGGEST_STATE = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'suggest-'));
const { validate } = require('./suggest.js');
const body = (steps = '- [ ] do it') => `## Problem\nx\n## Proposal\nx\n## Acceptance criteria\n- x\n## Plan\nx\n## Steps\n${steps}\n`;

test('a well-formed proposal passes with labels kind, mode (and epic)', () => {
  const v = validate({ proposals: [{ title: 'Rotate the logs', kind: 'cleanup', mode: 'afk', epic: true, body: body() }] }, [], 3);
  assert.deepStrictEqual(v.ok.map(p => p.labels), [['cleanup', 'afk', 'epic']]);
});
test('bad shapes are dropped', () => {
  const v = validate({ proposals: [
    { title: 'x', kind: 'cleanup', mode: 'afk', body: body() },
    { title: 'Wrong kind here', kind: 'party', mode: 'afk', body: body() },
    { title: 'Missing sections', kind: 'docs', mode: 'afk', body: '## Problem\nx' },
    { title: 'HITL without a step', kind: 'docs', mode: 'hitl', body: body() },
    { title: 'AFK with an owner step', kind: 'docs', mode: 'afk', body: body('- [ ] (HITL) buy a disk (money)') },
    { title: 'Smuggled comments', kind: 'docs', mode: 'afk', body: body() + '## Comments\nhi' },
    { title: 'Already proposed', kind: 'docs', mode: 'afk', body: body() },
  ] }, ['already proposed'], 5);
  assert.strictEqual(v.ok.length, 0);
  assert.strictEqual(v.bad.length, 7);
});
test('at most N', () => {
  const ps = [1, 2, 3].map(i => ({ title: `Idea number ${i}`, kind: 'feature', mode: 'afk', body: body() }));
  assert.strictEqual(validate({ proposals: ps }, [], 2).ok.length, 2);
});
