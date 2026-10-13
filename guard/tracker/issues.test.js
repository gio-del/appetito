'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse, serialize, housekeep, lint, similar, corpus } = require('./issues.js');

function repo(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'issues-'));
  for (const s of ['open', 'done']) fs.mkdirSync(path.join(d, 'issues', s), { recursive: true });
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(d, 'issues', f), c);
  return d;
}
const issue = (title, fields, body = '') => `# ${title}\n\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${body}\n`;

test('parse/serialize round trip keeps fields, body and comments', () => {
  const t = issue('T', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'todo' }, 'Body\n\n```\n## Comments inside a fence\n```\n\n## Comments\n\n### 2026-01-02 10:00 (owner)\nHi');
  const p = parse(t);
  assert.strictEqual(p.comments.length, 1);
  assert.match(p.desc, /inside a fence/);
  assert.deepStrictEqual(parse(serialize(p)), p);
});
test('housekeep closes a finished epic and unblocks dependants', () => {
  const d = repo({
    'open/001-epic.md': issue('Epic', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'todo', Labels: 'epic' }),
    'done/002-child.md': issue('Child', { Opened: '2026-01-01', Closed: '2026-01-02', 'Blocked on': '-', Parent: '001' }),
    'open/003-after.md': issue('After', { Opened: '2026-01-01', 'Blocked on': 'issue 002', Status: 'todo' }),
  });
  const log = housekeep(d);
  assert.strictEqual(log.length, 2);
  assert.ok(fs.existsSync(path.join(d, 'issues', 'done', '001-epic.md')));
  assert.match(fs.readFileSync(path.join(d, 'issues', 'open', '003-after.md'), 'utf8'), /^Blocked on: -$/m);
});
test('lint finds shape problems', () => {
  const d = repo({
    'open/001-a.md': issue('A', { Opened: '2026-01-01', 'Blocked on': '-' }),
    'open/002-b.md': issue('B', { Opened: '2026-01-01', 'Blocked on': 'user', Status: 'todo' }, '- [ ] something the agent could do'),
    'open/003-c.md': issue('C', { Opened: '2026-01-01', 'Blocked on': 'issue 999', Status: 'todo' }),
  });
  const rules = lint(d).map(x => `${x.id}:${x.rule}`).sort();
  assert.deepStrictEqual(rules, ['001:no-status', '002:hidden-work', '003:blocker-missing']);
});
test('similar finds the look-alike issue', () => {
  const d = repo({
    'open/001-vw.md': issue('Add Vaultwarden password manager', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'todo' }, 'Self-hosted password manager with encrypted backup'),
    'open/002-dns.md': issue('Add AdGuard Home', { Opened: '2026-01-01', 'Blocked on': '-', Status: 'todo' }, 'LAN ad blocking DNS'),
  });
  const r = similar(corpus(d, false), 'Install a password manager (Vaultwarden)', 'with backups');
  assert.strictEqual(r[0].id, '001');
});
