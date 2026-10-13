# Second brain: vault, Syncthing, sorting, proposals, per-uid firewall
Opened: 2026-10-13
Blocked on: issue 003
Status: todo
Priority: medium
Labels: core

PRD §2 row 7, §4.6–4.7, §5. Source: `brain-setup`, `brain-sort`, `brain-propose`, `vault-autocommit`, `brain/`, `brain-fw.sh`.

- [ ] User `brain`, vault (English folder names, configurable), Syncthing tailnet-only (no discovery/relays/NAT)
- [ ] `brain-sort` via agent-run (profile `vault-edit`), fixed rules root-owned in `guard/brain/`, answers in the note's language, urgency tag
- [ ] `brain-propose` → tracker `/api/propose` with the brain token
- [ ] nftables/iptables per-uid firewall for `agent` and `brain`

Acceptance: e2e: a note in `Inbox/` is sorted and a proposal appears.
