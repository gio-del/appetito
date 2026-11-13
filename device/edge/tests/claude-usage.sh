#!/bin/sh
# Test of claude-usage (issue 111) on synthetic ops-auto runs: cost = last cumulative total_cost_usd,
# tokens/turns summed over result lines, quota deltas per window (a new resetsAt = a new window),
# outcome from ops-auto.log, labels from the issue, no message/tool-output text in the JSON, and the
# --windows history (per window: final, per job, unattributed, hours stopped for quota; old lines kept),
# interactive sessions (job ops-interattivo) from transcripts: usage deduplicated by message.id (last
# copy), list price with 5 min / 1 h cache writes, headless (sdk-cli) transcripts skipped, --since;
# brain (issue 130): brain-usage on a synthetic brain-sort run and brain session prints numbers only
# (no SECRET text, no vault path), claude-usage adds jobs brain-sort/brain-interattivo and their quota.
# usage.json (--card, issue 131): numbers of the last 7 days only, no text or path; the tracker serves it.
# Quality and determinism (issue 132): closes/reopens from git renames, follow-ups within 48 h on the same
# code, reverts, failed deploys (tool_result is_error), monitor/lint issues per fingerprint kind, context sizes.
# From the repo root: device/edge/tests/claude-usage.sh
set -eu
R=$(pwd)
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
mkdir -p "$t/runs" "$t/repo/issues/open" "$t/repo/issues/done"
printf '# A\n\nLabels: monitor, ops\nStatus: todo\n' > "$t/repo/issues/done/201-a.md"
printf '# B\n\nStatus: todo\n' > "$t/repo/issues/open/202-b.md"
# git history (issue 132; 201 and 303 are written straight into done/, which counts as closed): 301 closed with code, 302 touches the same file 47 h later, 303 reopened, a revert,
# lint issue 304 written straight into done/ with no code change; 305 an open monitor issue.
g() { git -C "$t/repo" -c user.name=t -c user.email=t@t "$@" >/dev/null; }
gc() { d=$1 m=$2; shift 2; GIT_AUTHOR_DATE=$d GIT_COMMITTER_DATE=$d g commit -qm "$m" "$@"; }
g init -q; g add -A; gc "2026-09-20T10:00:00Z" "init"
mkdir -p "$t/repo/device" "$t/repo/docs"
printf "# x\n" > "$t/repo/issues/open/301-x.md"; printf "# y\n" > "$t/repo/issues/done/303-y.md"; g add -A; gc "2026-10-01T09:00:00Z" "issues"
echo 1 > "$t/repo/device/x.sh"; echo 1 > "$t/repo/docs/d.md"; g add -A; gc "2026-10-01T10:00:00Z" "301: x"
g mv issues/open/301-x.md issues/done/301-x.md; gc "2026-10-01T11:00:00Z" "301: chiusa"
echo 2 > "$t/repo/device/x.sh"; g add -A; gc "2026-10-03T10:00:00Z" "302: tocca x"
echo 2 > "$t/repo/docs/d.md"; g add -A; gc "2026-10-03T10:30:00Z" "306: solo docs"
g mv issues/done/303-y.md issues/open/303-y.md; gc "2026-10-03T12:00:00Z" "303: riaperta"
gc "2026-10-03T13:00:00Z" "Revert \"302: tocca x\"" --allow-empty
printf "# l\n\nOpened: 2026-10-02\nFingerprint: lint-no-status-9\n" > "$t/repo/issues/done/304-l.md"; g add -A; gc "2026-10-03T14:00:00Z" "304: lint"
printf "# m\n\nOpened: 2026-10-02\nFingerprint: svc-homepage\nStatus: todo\n" > "$t/repo/issues/open/305-m.md"
rl() { echo '{"type":"rate_limit_event","rate_limit_info":{"status":"'"${4:-allowed}"'","unifiedWindows":{"five_hour":{"utilization":'"$1"',"resetsAt":'"$2"'},"seven_day":{"utilization":'"$3"',"resetsAt":1791000000}}}}'; }
{
	echo '{"type":"system","subtype":"init","model":"claude-test-1"}'
	rl 0.10 100 0.20
	echo '{"type":"assistant","message":{"id":"m1","usage":{"input_tokens":2,"cache_creation_input_tokens":1000,"cache_read_input_tokens":9000,"output_tokens":5},"content":[{"type":"text","text":"SECRET-TEXT"},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"device/edge/deploy"}}]}}'
	echo '{"type":"assistant","message":{"id":"m1","usage":{"input_tokens":2,"cache_creation_input_tokens":1000,"cache_read_input_tokens":9000,"output_tokens":5},"content":[{"type":"tool_use","id":"t2","name":"Read","input":{"file_path":"/x/f.md"}}]}}'
	echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":true,"content":"SECRET-OUTPUT-12345"},{"type":"tool_result","tool_use_id":"t2","content":[{"type":"text","text":"0123456789"}]}]}}'
	echo '{"type":"assistant","message":{"id":"m2","content":[{"type":"tool_use","id":"t3","name":"Bash","input":{"command":"git commit -m x"}},{"type":"tool_use","id":"t4","name":"Bash","input":{"command":"sed -i s/a/b/ f"}},{"type":"tool_use","id":"t5","name":"Bash","input":{"command":"grep -n x f"}}]}}'
	rl 0.30 100 0.25
	rl 0.02 200 0.26
	rl 0.05 200 0.27
	echo '{"type":"result","subtype":"success","is_error":false,"result":"SECRET-RESULT","total_cost_usd":1.0,"num_turns":4,"duration_ms":60000,"usage":{"input_tokens":4,"cache_creation_input_tokens":2000,"cache_read_input_tokens":18000,"output_tokens":100,"output_tokens_details":{"thinking_tokens":30}},"permission_denials":[{"tool_name":"Bash","tool_input":{"command":"cd /srv/SECRET-DIR && sudo mytool --token=SECRET-CMD"}},{"tool_name":"Write","tool_input":{"file_path":"/SECRET-PATH"}}]}'
	echo '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":1.5,"num_turns":1,"duration_ms":30000,"usage":{"input_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":5000,"output_tokens":10}}'
} | gzip > "$t/runs/2026-10-01_1007_201.jsonl.gz"
{
	echo '{"type":"system","subtype":"init","model":"claude-test-1"}'
	rl 0.50 300 0.40 rejected
	echo '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.25,"num_turns":1,"duration_ms":1000,"usage":{"input_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":1}}'
} > "$t/runs/2026-10-02_1037_202.jsonl"
cat > "$t/ops-auto.log" <<'EOF'
2026-10-01 10:07:01 #201: run 2 (201-a.md)
2026-10-01 10:08:00 #201: chiusa rc=0 {}
2026-10-02 10:38:01 #202: run 1 (202-b.md)
2026-10-02 10:39:00 #202: in corso rc=0 {}
EOF
printf '2026-10-01 10:37:02 round end: fermo per la quota\n' >> "$t/ops-auto.log"
printf '2026-10-01 10:50:01 skip: quota settimanale 53%% (max 50%%)\n' > "$t/ops-suggest.log"
mkdir -p "$t/sessions/-p"
{
	echo '{"type":"user","entrypoint":"cli","timestamp":"2026-09-30T08:00:00Z","message":{"content":"SECRET-PROMPT"}}'
	echo '{"type":"assistant","entrypoint":"cli","timestamp":"2026-09-30T08:00:05Z","message":{"id":"s0","model":"claude-opus-5-5","usage":{"input_tokens":1000000,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0},"content":[]}}'
	echo '{"type":"assistant","entrypoint":"cli","timestamp":"2026-10-01T08:00:05Z","message":{"id":"s1","model":"claude-opus-5-5","usage":{"input_tokens":10,"cache_creation_input_tokens":3000000,"cache_read_input_tokens":5000000,"output_tokens":1,"cache_creation":{"ephemeral_5m_input_tokens":2000000,"ephemeral_1h_input_tokens":1000000}},"content":[{"type":"tool_use","id":"u1","name":"Bash","input":{"command":"ls"}}]}}'
	echo '{"type":"assistant","entrypoint":"cli","timestamp":"2026-10-01T08:00:06Z","message":{"id":"s1","model":"claude-opus-5-5","usage":{"input_tokens":10,"cache_creation_input_tokens":3000000,"cache_read_input_tokens":5000000,"output_tokens":100000,"cache_creation":{"ephemeral_5m_input_tokens":2000000,"ephemeral_1h_input_tokens":1000000}},"content":[{"type":"text","text":"SECRET-ANSWER"}]}}'
	echo '{"type":"user","entrypoint":"cli","timestamp":"2026-10-01T09:00:00Z","message":{"content":[{"type":"tool_result","tool_use_id":"u1","content":"SECRET-OUT"}]}}'
} > "$t/sessions/-p/aaaaaaaa-1.jsonl"
echo '{"type":"assistant","entrypoint":"sdk-cli","timestamp":"2026-10-01T08:00:00Z","message":{"id":"h1","model":"claude-opus-5-5","usage":{"input_tokens":5,"output_tokens":5},"content":[]}}' > "$t/sessions/-p/bbbbbbbb-2.jsonl"
echo '{"window":"five_hour","start":"1969-12-31T00:00:00.000Z","resetsAt":"1969-12-31T05:00:00.000Z","old":1}' > "$t/windows.jsonl"
printf '#!/bin/sh\necho "[]"\n' > "$t/no-brain"; chmod +x "$t/no-brain"
cu() { TZ=UTC CLAUDE_USAGE_HS_DOCS=$t/hs-docs-INDEX.md CLAUDE_USAGE_BRAIN=${CB:-$t/no-brain} CLAUDE_USAGE_RUNS=$t/runs CLAUDE_USAGE_LOG=$t/ops-auto.log CLAUDE_USAGE_SUGGEST_LOG=$t/ops-suggest.log CLAUDE_USAGE_WINDOWS=$t/windows.jsonl CLAUDE_USAGE_SESSIONS=$t/sessions HS_REPO=$t/repo node "$R/device/edge/debian/claude-usage" "$@"; }
cu --json --runs --job ops-auto > "$t/u.json"
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
j() { node -e 'const u=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(eval(process.argv[2]))' "$t/u.json" "$1"; }
check "cost = sum of last total_cost_usd per run" "$(j 'u.jobs["ops-auto"].costUsd')" 1.75
check "turns summed over result lines" "$(j 'u.runs[0].turns')" 5
check "tokens summed" "$(j 'Object.values(u.runs[0].tokens).join(",")')" "5,2000,23000,110,30"
check "prefix = first message" "$(j 'u.runs[0].prefixTokens')" 10002
check "5h quota split at reset" "$(j 'u.runs[0].quota.five_hour.delta')" 0.23
check "7d quota" "$(j 'u.runs[0].quota.seven_day.delta')" 0.07
check "bash categories" "$(j 'JSON.stringify(u.runs[0].bash)')" '{"deploy":1,"git":1,"modifica":1,"lettura":1}'
check "tool output bytes" "$(j 'u.runs[0].toolOutputBytes.Bash+","+u.runs[0].toolOutputBytes.Read')" "19,10"
check "denied" "$(j 'u.runs[0].denied')" 2
check "deniedTools" "$(j 'JSON.stringify(u.runs[0].deniedTools)')" '{"Bash":1,"Write":1}'
check "deniedBash: program only" "$(j 'JSON.stringify(u.runs[0].deniedBash)')" '{"mytool":1}'
check "deploys, failed (is_error only)" "$(j 'u.runs[0].deploys+","+u.runs[0].deploysFailed+","+u.jobs["ops-auto"].deploysFailed')" "1,1,1"
check "quality: closed, reopened, followed up, reverts" "$(j 'const q=u.quality;[q.closed,q.reopened,q.followedUp48h,q.reverts].join("|")')" "4|303|301|1"
check "determinism per fingerprint kind" "$(j 'JSON.stringify(u.determinism)')" '{"lint-no-status":{"opened":1,"open":0,"closed":1,"closedNoCode":1},"svc-homepage":{"opened":1,"open":1,"closed":0,"closedNoCode":0}}'
check "context files: bytes/4, missing = null" "$(j 'u.contextFiles.map(c=>c.file+"="+c.tokens).join(",")')" "CLAUDE.md=null,issues/README.md=null,device/edge/debian/ops-auto-prompt.md=null,device/edge/debian/ops-suggest-prompt.md=null,device/edge/debian/brain/sort-prompt.md=null"
check "hs-docs total missing = null" "$(j 'u.hsDocsKb')" null
printf '# Docs\n\nSearch: x. Total: 2756 KB.\n' > "$t/hs-docs-INDEX.md"
check "hs-docs total from INDEX.md" "$(cu --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).hsDocsKb))')" 2756
check "hs-docs total in text" "$(cu | grep -c "hs-docs): 2756 KB")" 1
check "quality --since" "$(cu --json --since 2026-10-02 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const u=JSON.parse(s);console.log(u.quality.closed+","+Object.keys(u.determinism).length)})')" "1,2"
check "outcome + attempt from log" "$(j 'u.runs[0].outcome+","+u.runs[0].attempt')" "chiusa,2"
check "rejected = limite" "$(j 'u.runs[1].outcome')" limite
check "labels" "$(j 'u.runs[0].labels.join(",")+"|"+u.runs[1].labels.join(",")')" "monitor,ops|(nessuna)"
check "mechanical share" "$(j 'u.mechanicalShare')" 0.857
check "closed at 2nd attempt" "$(j 'u.closedAtAttempt[2]')" 1
check "--since filters" "$(cu --json --since 2026-10-02 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).jobs["ops-auto"].runs))')" 1
check "no text in JSON" "$(grep -c SECRET "$t/u.json" || true)" 0
cu --windows > /dev/null
w() { node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);console.log(eval(process.argv[2]))' "$t/windows.jsonl" "$1"; }
check "windows: one line per window + old kept" "$(w 'l.length')" 5
check "windows: old history kept" "$(w 'l.filter(x=>x.old).length')" 1
check "windows: 5h first window" "$(w 'JSON.stringify(l.find(x=>x.resetsAt==="1970-01-01T00:01:40.000Z")).replace(/"start":"[^"]*",/,"")')" '{"window":"five_hour","resetsAt":"1970-01-01T00:01:40.000Z","closed":true,"runs":1,"firstPct":10,"finalPct":30,"unusedPct":70,"jobsPct":{"ops-auto":20},"unattributedPct":10,"stoppedForQuotaHours":{}}'
check "windows: 7d window, unattributed between runs" "$(w 'const x=l.find(x=>x.window==="seven_day");[x.runs,x.firstPct,x.finalPct,x.jobsPct["ops-auto"],x.unattributedPct].join(",")')" "2,20,40,7,33"
check "windows: stopped for quota hours" "$(w 'JSON.stringify(l.find(x=>x.window==="seven_day").stoppedForQuotaHours)')" '{"ops-auto":0.5,"ops-suggest":1}'
cu --json --runs --since 2026-10-01 > "$t/u.json"
check "interactive: one session, sdk-cli skipped, --since" "$(j 'u.jobs["ops-interattivo"].runs+","+u.runs.filter(r=>r.job==="ops-interattivo").length')" "1,1"
check "interactive: last usage copy per message" "$(j 'Object.values(u.runs.find(r=>r.job==="ops-interattivo").tokens).join(",")')" "10,3000000,5000000,100000,0"
check "interactive: list price" "$(j 'u.jobs["ops-interattivo"].costUsd')" 21
check "interactive: tools, wall duration" "$(j 'const r=u.runs.find(r=>r.job==="ops-interattivo");r.tools.Bash+","+r.durationMs+","+r.toolOutputBytes.Bash+","+r.start')" "1,3595000,10,2026-10-01 08:00"
check "interactive: no labels, ops-auto mechanical share unchanged" "$(j 'Object.keys(u.labels).length+","+u.mechanicalShare')" "3,0.857"
check "no text in JSON (sessions)" "$(grep -c SECRET "$t/u.json" || true)" 0
check "text output" "$(cu | grep -c '^== ops-auto: 2 run, \$1.75')" 1
mkdir -p "$t/brain/runs" "$t/brain/sessions/-srv-vault"
{
	echo '{"type":"system","subtype":"init","model":"claude-sonnet-5-5"}'
	echo '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","unifiedWindows":{"seven_day":{"utilization":0.40,"resetsAt":1791000000}}}}'
	echo '{"type":"assistant","message":{"id":"b1","usage":{"input_tokens":3,"cache_creation_input_tokens":100,"cache_read_input_tokens":900,"output_tokens":7},"content":[{"type":"text","text":"SECRET-NOTE"},{"type":"tool_use","id":"r1","name":"Read","input":{"file_path":"/srv/vault/Inbox/SECRET-NAME.md"}},{"type":"tool_use","id":"r2","name":"SECRET tool/x","input":{}}]}}'
	echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"r1","content":"SECRET-BODY"}]}}'
	echo '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","unifiedWindows":{"seven_day":{"utilization":0.45,"resetsAt":1791000000}}}}'
	echo '{"type":"result","subtype":"success","is_error":false,"result":"SECRET-RESULT","total_cost_usd":0.5,"num_turns":3,"duration_ms":9000,"usage":{"input_tokens":3,"cache_creation_input_tokens":100,"cache_read_input_tokens":900,"output_tokens":7},"permission_denials":[{"tool_name":"Bash","tool_input":{"command":"/tmp/x y"}}]}'
} | gzip > "$t/brain/runs/2026-10-02_1200_sort.jsonl.gz"
{
	echo '{"type":"user","entrypoint":"cli","timestamp":"2026-10-02T13:00:00Z","message":{"content":"SECRET-PROMPT"}}'
	echo '{"type":"assistant","entrypoint":"cli","timestamp":"2026-10-02T13:10:00Z","message":{"id":"c1","model":"claude-opus-5-5","usage":{"input_tokens":1000000,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0},"content":[{"type":"text","text":"SECRET-ANSWER"}]}}'
} > "$t/brain/sessions/-srv-vault/cccccccc-3.jsonl"
mkdir -p "$t/bin"; cp "$R/device/edge/debian/claude-usage" "$t/bin/claude-usage"
sed "s#/usr/local/lib/hs/claude-usage.js#/nonexistent/claude-usage.js#" "$R/device/edge/debian/brain-usage" > "$t/bin/brain-usage.js"  # test the repo copy, not the installed lib
bu() { TZ=UTC BRAIN_USAGE_RUNS=$t/brain/runs BRAIN_USAGE_SESSIONS=$t/brain/sessions node "$t/bin/brain-usage.js" "$@"; }
printf '#!/bin/sh\nexec env TZ=UTC BRAIN_USAGE_RUNS=%s BRAIN_USAGE_SESSIONS=%s node %s "$@"\n' "$t/brain/runs" "$t/brain/sessions" "$t/bin/brain-usage.js" > "$t/brain-usage"
chmod +x "$t/brain-usage"
bu > "$t/b.json"
check "brain-usage: no text, no vault path" "$(grep -c 'SECRET\|vault\|Inbox' "$t/b.json" || true)" 0
check "brain-usage: --since" "$(bu --since 2026-10-03)" "[]"
CB=$t/brain-usage cu --json --runs > "$t/u.json"
check "brain-sort: cost, turns, outcome, tools" "$(j 'const r=u.runs.find(r=>r.job==="brain-sort");[r.cost,r.turns,r.outcome,r.model,r.denied,JSON.stringify(r.tools),JSON.stringify(r.deniedTools)].join(",")')" '0.5,3,ok,claude-sonnet-5-5,1,{"Read":1,"altro":1},{"Bash":1}'
check "brain-interattivo: list price, no labels" "$(j 'const s=u.jobs["brain-interattivo"];s.runs+","+s.costUsd+","+Object.keys(u.labels).length')" "1,4,3"
check "brain: no text in claude-usage JSON" "$(grep -c 'SECRET-\|vault' "$t/u.json" || true)" 0
CB=$t/brain-usage cu --windows > /dev/null
check "windows: brain-sort quota out of unattributed" "$(w 'const x=l.find(x=>x.window==="seven_day");[x.runs,x.finalPct,x.jobsPct["brain-sort"],x.unattributedPct].join(",")')" "3,45,5,33"
check "brain-usage missing: brain left out" "$(CB=/nonexistent cu --json --job brain-sort 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Object.keys(JSON.parse(s).jobs).length))')" 0

check "text: quality, determinism, context" "$(cu | grep -c '^Qualità: 4 issue chiuse, riaperte 1 (#303), seguite entro 48 h da un.altra issue sugli stessi file 1 (#301), commit revertiti 1$\|^   lint-no-status: 1, aperte 0, chiuse 1, senza codice 1$\|^File di contesto')" 3

# usage.json (--card, issue 131): last 7 days only, numbers only (no text, no path), served by the tracker.
now=$(TZ=UTC date +%Y-%m-%d_%H00)
printf '# C\n\nLabels: ops, SECRET/label\nStatus: todo\n' > "$t/repo/issues/open/203-c.md"
{
	echo '{"type":"system","subtype":"init","model":"claude-test-1"}'
	echo '{"type":"assistant","message":{"id":"n1","usage":{"input_tokens":2,"cache_creation_input_tokens":100,"cache_read_input_tokens":900,"output_tokens":5},"content":[{"type":"text","text":"SECRET-TEXT"},{"type":"tool_use","id":"n2","name":"Read","input":{"file_path":"/home/SECRET/f.md"}}]}}'
	echo '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"n2","content":"SECRET-OUTPUT"}]}}'
	echo '{"type":"result","subtype":"success","is_error":false,"result":"SECRET-RESULT","total_cost_usd":0.75,"num_turns":2,"duration_ms":6000,"usage":{"input_tokens":2,"cache_creation_input_tokens":100,"cache_read_input_tokens":900,"output_tokens":5}}'
} > "$t/runs/${now}_203.jsonl"
CB=$t/brain-usage CLAUDE_USAGE_CARD=$t/usage.json cu --card
c() { node -e 'const u=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(eval(process.argv[2]))' "$t/usage.json" "$1"; }
check "card: only the last 7 days" "$(c 'u.jobs["ops-auto"].runs+","+u.jobs["ops-auto"].costUsd+","+u.days')" "1,0.75,7"
check "card: top issue with sanitized labels" "$(c 'const i=u.topIssues[0];[i.issue,i.costUsd,i.labels.join("+")].join(",")')" "203,0.75,ops+altro"
check "card: 7-day windows with per-job and unattributed quota" "$(c 'const w=u.windows[u.windows.length-1];[w.finalPct,w.jobsPct["brain-sort"],w.unattributedPct].join(",")')" "45,5,33"
check "card: byIssue has cost, runs, attempts" "$(c 'const i=u.byIssue["203"];[i.costUsd,i.runs,i.attempts].join(",")')" "0.75,1,0"
check "--by-issue: json and text" "$(CB=$t/brain-usage cu --by-issue --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const a=JSON.parse(s).find(x=>x.issue==="203");console.log([a.costUsd,a.runs,a.attempts].join(","))})'),$(CB=$t/brain-usage cu --by-issue | grep -c '^   #203: \$0.75, 1 run')" "0.75,1,0,1"
check "card: no text, no path" "$(grep -c 'SECRET\|/' "$t/usage.json" || true)" 0
check "card: windows history updated" "$(w 'l.filter(x=>x.old).length')" 1
PORT=${PORT:-3916} O="https://test.example:8444"
mkdir -p "$t/state"
node -e '
const c = require("node:crypto"), s = c.randomBytes(16), N = 16384, r = 8, p = 1;
const k = c.scryptSync("test-password-123", s, 32, { N, r, p, maxmem: 256 * N * r + (1 << 20) });
process.stdout.write(["scrypt", N, r, p, s.toString("base64"), k.toString("base64")].join("$") + "\n");' > "$t/state/password"
TRACKER_REPO=$t/repo TRACKER_STATE=$t/state TRACKER_PORT=$PORT TRACKER_ORIGINS=$O TRACKER_AUTO_USAGE=$t/usage.json TRACKER_AUTO_SIGNALS=$t/signals.json \
	TRACKER_SETTINGS=$t/settings.env node "$R/device/edge/tracker/server.js" > "$t/tlog" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null; rm -rf "$t"' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null && break; sleep 0.3; done
H="-H Host:test.example:8444 -H Origin:$O -H Content-Type:application/json"
check "tracker: usage needs a session" "$(curl -s -o /dev/null -w '%{http_code}' $H "http://127.0.0.1:$PORT/api/auto/usage")" 401
ck=$(curl -s -D - -o /dev/null $H -d '{"password":"test-password-123"}' "http://127.0.0.1:$PORT/api/login" \
	| sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\).*/\1/p' | head -1)
check "tracker: usage served" "$(curl -s $H -H "Cookie: $ck" "http://127.0.0.1:$PORT/api/auto/usage" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).topIssues[0].issue))')" 203
check "page: Consumo section" "$(grep -c 'id="au-usage"' "$R/device/edge/tracker/public/auto.html"),$(grep -c "api('GET', '/api/auto/usage')" "$R/device/edge/tracker/public/auto.js")" "1,1"
check "tracker: signals needs a session" "$(curl -s -o /dev/null -w '%{http_code}' $H "http://127.0.0.1:$PORT/api/auto/signals")" 401
check "tracker: signals missing file" "$(curl -s $H -H "Cookie: $ck" "http://127.0.0.1:$PORT/api/auto/signals" | jq -r .missing)" true
echo '{"v":1,"generated":"2026-10-29T10:00:00.000Z","signals":[{"id":"sig-denied","over":true,"count":4}]}' > "$t/signals.json"
check "tracker: signals served" "$(curl -s $H -H "Cookie: $ck" "http://127.0.0.1:$PORT/api/auto/signals" | jq -r '.signals[0].id')" sig-denied
check "page: Segnali section" "$(grep -c 'id="au-signals"' "$R/device/edge/tracker/public/auto.html"),$(grep -c "api('GET', '/api/auto/signals')" "$R/device/edge/tracker/public/auto.js")" "1,1"
exit $fail
