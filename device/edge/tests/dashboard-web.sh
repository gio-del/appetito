#!/bin/sh
# Static dashboard (issue 109): files present, strict CSP without inline code, manifest valid,
# cards.js evaluates, every JSON field a card reads exists in the sample data shape, app.js has no innerHTML.
# From the repo root: device/edge/tests/dashboard-web.sh
set -eu
W=device/edge/debian/dashboard-web
for f in index.html style.css app.js cards.js manifest.webmanifest icon.svg; do [ -s "$W/$f" ] || { echo "dashboard-web: missing $f" >&2; exit 1; }; done
grep -q "script-src 'self'" "$W/index.html" || { echo "dashboard-web: CSP missing" >&2; exit 1; }
if grep -Eq '<script>|<script [^>]*[^c]>[^<]|style=|onclick=' "$W/index.html"; then echo "dashboard-web: inline code in index.html" >&2; exit 1; fi
if grep -q "innerHTML" "$W/app.js"; then echo "dashboard-web: innerHTML" >&2; exit 1; fi
node -e '
const fs = require("fs"), assert = require("assert");
const m = JSON.parse(fs.readFileSync(process.argv[1] + "/manifest.webmanifest"));
assert.equal(m.display, "standalone");
new Function(fs.readFileSync(process.argv[1] + "/app.js", "utf8"));
const g = new Function(fs.readFileSync(process.argv[1] + "/cards.js", "utf8") + ";return {GROUPS, TIPS, RES_TIPS, MON}")();
assert.equal(g.RES_TIPS.length, 4);
for (const grp of g.GROUPS) for (const c of grp.cards) {
  assert.ok(c.title && c.desc, "card " + c.title);
  for (const w of c.srcs || (c.src ? [c] : [])) for (const [path, label] of w.fields) assert.ok(path && label, c.title);
  if (c.href) assert.match(c.href, /^https?:\/\//);
}
const titles = g.GROUPS.flatMap((x) => x.cards.map((c) => c.title));
for (const t of g.MON) assert.ok(titles.includes(t), "MON " + t);
console.log("dashboard-web: ok");
' "$W"
