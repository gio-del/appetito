# Security model enforced by the OS + audit
Opened: 2026-10-13
Blocked on: issue 006
Status: todo
Priority: urgent
Labels: gate-3, guard

PRD §4, gate 3. Source: `scripts/security-audit`, `ports-check`, `tailscale/policy.template.hujson`.

- [ ] Users `agent` (no sudo), `brain`, `tracker`; `security-audit` + `ports-check` generalized for a normal systemd host
- [ ] Tailscale policy template with `tests`
- [ ] Test (a): `agent` can't sudo; audit green in the sandbox

Acceptance: gate 3 tests green.

## Progress (2026-10-13)
- Done: users and groups (installer), `security-audit` and `ports-check` for a systemd host, per-uid nftables firewall + egress proxy with host allowlists, test (a) in `tests/e2e/security.sh` — green, and `security-audit` green in the sandbox (smoke scenario).
- Next: Tailscale policy template with `tests` (`guard/tailscale/policy.template.hujson`).
