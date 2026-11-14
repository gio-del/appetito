#!/bin/sh
# Rule for the settings schema (issue 223): every setting has level essential|advanced and a one-line
# hint of at most 80 characters (no issue numbers, no file names); at most 6 are essential.
# From the repo root: device/edge/tests/settings-schema.sh
set -eu
node -e '
const s = require(process.argv[1]); let bad = 0, ess = 0;
const fail = m => { console.log("FAIL " + m); bad = 1; };
for (const [k, v] of Object.entries(s)) {
  if (v.level !== "essential" && v.level !== "advanced") fail(k + ": level mancante (nuove impostazioni: advanced)");
  if (v.level === "essential") ess++;
  if (typeof v.hint !== "string" || !v.hint) fail(k + ": hint mancante");
  else if (v.hint.length > 80) fail(k + ": hint oltre 80 caratteri");
  else if (/\b(issue|#)\s*\d|\.(sh|js|json|md|env)\b/i.test(v.hint)) fail(k + ": hint con numeri di issue o nomi di file");
  if (!v.desc) fail(k + ": desc mancante");
}
// Every Project with proposals has its HS_SUGGEST_PAUSE_<NAME> (issue 271).
// The Projects list is private to the owner: the public copy has none (issue 578).
for (const l of (require("fs").existsSync(process.argv[2]) ? require("fs").readFileSync(process.argv[2], "utf8") : "").split("\n")) {
  const c = l.split("|").map(x => x.trim());
  if (l.startsWith("#") || c.length < 5 || !c[0] || c[4] === "-") continue;
  const k = "HS_SUGGEST_PAUSE_" + c[0].toUpperCase().replace(/-/g, "_");
  if (!s[k]) fail(k + ": manca (Project con proposte)");
}
if (ess > 6) fail("piu di 6 impostazioni essenziali: " + ess);
if (!bad) console.log("ok   settings schema: level e hint di " + Object.keys(s).length + " impostazioni");
process.exit(bad);' "$(pwd)/device/edge/tracker/settings.schema.json" "$(pwd)/device/edge/debian/projects"
