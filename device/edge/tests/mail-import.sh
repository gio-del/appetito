#!/bin/sh
# Test of the mail bridge (issue 015): edge-mail.gs, mail-import.js, mail-inbox-move. From the repo root: device/edge/tests/mail-import.sh
set -eu
exec node "$(dirname "$0")/mail-import.js"
