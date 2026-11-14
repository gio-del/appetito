#!/bin/sh
# Every Caddy site that serves static files carries Cache-Control (issue 579): without it Chrome
# keeps the old page for days (heuristic cache).
set -eu
cd "$(dirname "$0")/.."
awk '
/^[^ \t#}(].*\{$/ { site = $0; fs = 0; cc = 0 }
/file_server/ { fs = 1 }
/Cache-Control/ { cc = 1 }
/^}/ { if (fs && !cc) { print "FAIL: sito con file_server senza Cache-Control: " site; bad = 1 } }
END { exit bad }
' debian/Caddyfile
echo ok
