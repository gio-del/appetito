#!/bin/sh
# Issue 472: DIREZIONE.md exists and the job prompts and CLAUDE.md point at it.
cd "$(dirname "$0")/../../.." || exit 1
f=0
[ -s DIREZIONE.md ] || { echo "FAIL DIREZIONE.md missing"; f=1; }
for p in device/edge/debian/ops-suggest-prompt.md device/edge/debian/ops-auto-prompt.md CLAUDE.md; do
	grep -q 'DIREZIONE.md' "$p" || { echo "FAIL $p does not mention DIREZIONE.md"; f=1; }
done
[ $f -eq 0 ] && echo "ok direzione"
exit $f
