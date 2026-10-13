# Second brain: vault, Syncthing, sorting, proposals, per-uid firewall
Opened: 2026-10-13
Closed: 2026-10-13
Status: done
Priority: medium
Labels: core

PRD §2 row 7, §4.6–4.7, §5. Source: `brain-setup`, `brain-sort`, `brain-propose`, `vault-autocommit`, `brain/`, `brain-fw.sh`.

- [x] User `brain`, vault (English folder names, configurable), Syncthing tailnet-only (no discovery/relays/NAT)
- [x] `brain-sort` via agent-run (profile `vault-edit`), fixed rules root-owned in `guard/brain/`, answers in the note's language, urgency tag
- [x] `brain-propose` → tracker `/api/propose` with the brain token
- [x] nftables/iptables per-uid firewall for `agent` and `brain`

Acceptance: e2e: a note in `Inbox/` is sorted and a proposal appears.

## Progress

- 2026-10-13: `tests/e2e/run --scenario brain` PASS (1 min 27 s, Debian 13 amd64, Sonnet): a `#now` note in `Inbox/` was sorted into `Projects/Home Server/` within 20 s and proposed as #006 (Source: brain); checks green, firewall rules for brain present. The Ollama side of agent-run stays with issue 003.
