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
