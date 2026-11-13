#!/bin/sh
# Test of the nightly check of main (issue 142): check-nightly on a fake repo whose device/edge/check
# fails, then green; hs-monitor turns the red runs into finding check-main, once per run, nothing when
# green. Run from the repo root: device/edge/tests/check-nightly.sh
set -eu
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
D=$PWD/device/edge/debian
git init -q -b main "$t/src"
mkdir -p "$t/src/device/edge"
cat > "$t/src/device/edge/check" <<'C'
#!/bin/sh
echo "note issues-lint: 1 violazioni"
echo "    #001 no-status: x"
echo "FAIL test device/edge/tests/finto.sh"
echo "    FAIL: finto"
echo "check failed: 1"
exit 1
C
chmod +x "$t/src/device/edge/check"
git -C "$t/src" add -A && git -C "$t/src" -c user.name=t -c user.email=t@t commit -qm red
# Uncommitted work in the source repo must not be seen: the clone is of main's last commit.
printf "#!/bin/sh\necho 'check ok (1 file)'\n" > "$t/src/device/edge/check"
export HS_CHECK_REPO="$t/src" HS_CHECK_STATE="$t/state/last.json"
fail() { echo "FAIL: check-nightly: $1"; exit 1; }

"$D/check-nightly" > "$t/out" 2>&1 || fail "exit code on a red check"
cp "$HS_CHECK_STATE" "$t/red1.json"
jq -e '.ok == false and .fails == ["FAIL test device/edge/tests/finto.sh", "    FAIL: finto"]' "$t/red1.json" > /dev/null || fail "state of a red run: $(cat "$t/red1.json")"
sleep 1
"$D/check-nightly" > "$t/out" 2>&1 || fail "exit code on a red check (2)"
cp "$HS_CHECK_STATE" "$t/red2.json"

git -C "$t/src" -c user.name=t -c user.email=t@t commit -qam green
sleep 1
"$D/check-nightly" > "$t/out" 2>&1 || fail "exit code on a green check"
cp "$HS_CHECK_STATE" "$t/green.json"
jq -e '.ok == true and .fails == []' "$t/green.json" > /dev/null || fail "state of a green run: $(cat "$t/green.json")"
HS_CHECK_REPO="$t/none" "$D/check-nightly" > "$t/out" 2>&1 && fail "no repo should exit non-zero"

# hs-monitor: red (issue), same file again (nothing), red next night (finding again: comment), green (nothing).
jq -n --slurpfile a "$t/red1.json" --slurpfile b "$t/red2.json" --slurpfile c "$t/green.json" \
	'{runs: [$a[0], $a[0], $b[0], $c[0], $c[0]]}' > "$t/runs.json"
"$D/hs-monitor" --check-nightly-test "$t/runs.json" | jq -c 'map({fp, title, n: (.detail | split("\n") | length)})' > "$t/got"
cat > "$t/want" <<'W'
[{"fp":"check-main","title":"Il check notturno di main fallisce","n":2}]
[]
[{"fp":"check-main","title":"Il check notturno di main fallisce","n":2}]
[]
[]
W
if diff -u "$t/want" "$t/got"; then echo "ok: check-nightly"; else echo "FAIL: check-nightly"; exit 1; fi
