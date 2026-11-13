#!/bin/sh
# Test of ai-run (issue 249): refuses a call without --strict-mcp-config or without web tools denied,
# runs the stubbed claude otherwise, and an unknown backend value falls back to headless.
# From the repo root: device/edge/tests/ai-run.sh
set -eu
A=$(pwd)/device/edge/debian/ai-run
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
mkdir "$t/bin"
printf '#!/bin/sh\necho "claude $*"\n' > "$t/bin/claude"
printf '#!/bin/sh\necho "${HS_FAKE_BACKEND:-headless}"\n' > "$t/bin/hs-setting"
chmod +x "$t/bin/"*
fail=0
check() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1: got '$2', want '$3'"; fail=1; }; }
run() { PATH=$t/bin:$PATH sh "$A" "$@" 2>&1 || echo "rc=$?"; }
check "ok call" "$(run -p hi --strict-mcp-config --disallowedTools "WebFetch WebSearch")" "claude -p hi --strict-mcp-config --disallowedTools WebFetch WebSearch"
check "--tools instead of deny list" "$(run -p hi --strict-mcp-config --tools Read | head -1)" "claude -p hi --strict-mcp-config --tools Read"
check "no strict-mcp-config" "$(run -p hi --disallowedTools "WebFetch WebSearch" | tail -1)" "rc=2"
check "web tools not denied" "$(run -p hi --strict-mcp-config | tail -1)" "rc=2"
check "unknown backend = headless" "$(HS_FAKE_BACKEND=zzz run -p hi --strict-mcp-config --tools Read)" "claude -p hi --strict-mcp-config --tools Read"
# API backend (issue 263): text-only calls go to ai-api, others stay on claude; the key never reaches output or argv.
printf '#!/bin/sh\necho "api $*"\n' > "$t/ai-api"; chmod +x "$t/ai-api"
runb() { HS_AI_API=$t/ai-api HS_FAKE_BACKEND=api-openai PATH=$t/bin:$PATH sh "$A" "$@" 2>&1 || echo "rc=$?"; }
check "api text-only" "$(runb -p hi --strict-mcp-config --tools "" --disallowedTools "WebFetch WebSearch")" "api openai -p hi --strict-mcp-config --tools  --disallowedTools WebFetch WebSearch"
check "api with tools stays headless" "$(runb -p hi --strict-mcp-config --tools Read)" "claude -p hi --strict-mcp-config --tools Read"
# ai-api against a fake curl: key via stdin config, not argv; output is stream-json.
mkdir "$t/b2"; cp "$t/bin/"* "$t/b2/"
printf '#!/bin/sh\necho "ARGV: $*" >> "$CURL_LOG"\ncat >> "$CURL_LOG"\necho '"'"'{"choices":[{"message":{"content":"ciao"}}]}'"'"'\n' > "$t/b2/curl"; chmod +x "$t/b2/curl"
printf "KEY=sk-SECRET123\nURL=http://x\nMODEL=m1\n" > "$t/conf"; chmod 600 "$t/conf"
out=$(AI_API_CONF=$t/conf CURL_LOG=$t/curl.log PATH=$t/b2:$PATH sh "$(dirname "$A")/ai-api" openai -p hi --append-system-prompt sys 2>&1)
check "ai-api result" "$(printf "%s" "$out" | jq -r 'select(.type=="result") | .result')" "ciao"
check "key not in output" "$(printf "%s" "$out" | grep -c SECRET123 || true)" "0"
check "key not in argv" "$(grep "^ARGV" "$t/curl.log" | grep -c SECRET123 || true)" "0"
check "key sent via stdin" "$(grep -c "Bearer sk-SECRET123" "$t/curl.log")" "1"
exit $fail
