# Add AdGuard Home (ad and tracker blocking for the home network)

> Not yet run end to end in appetito's own e2e sandbox (Vaultwarden, #001, is). It should work; if the agent struggles, refine this text.

Opened: 2026-10-13
Blocked on: -
Status: backlog
Priority: medium
Labels: service, network

Block ads and trackers for every device at home by using this server as the LAN's DNS.

## What
- A service `adguardhome` running [AdGuard Home](https://github.com/AdguardTeam/AdGuardHome) from its official release (pinned version and SHA-256, fetched by the service user, amd64/arm64).
- DNS on port 53 for the LAN (`LOW_PORT=yes`: `CAP_NET_BIND_SERVICE` only), its web UI on `127.0.0.1:3000` only.
- Upstreams over DNS-over-HTTPS (e.g. Quad9 and Cloudflare), the AdGuard DNS filter and one well-maintained blocklist; query log kept 24 h.
- Configuration in the repo as a template (no password in it); the admin password is generated at first start into `/var/lib/adguardhome` and shown to the owner through a `(HITL)` step.

## Acceptance criteria
- `dig @127.0.0.1 example.com` resolves and `dig @127.0.0.1 doubleclick.net` is blocked (a probe in `tests/probes/`).
- `ports-check`: only `0.0.0.0:53/udp`, `0.0.0.0:53/tcp` and `127.0.0.1:3000` are open by `adguardhome`.
- Health URL answers; the unit runs as `adguardhome` with `NoNewPrivileges=yes`.

## Steps
- [ ] Service folder, fetch script, config template, unit, probe
- [ ] (HITL) In your router's settings, set this server's LAN address as the DNS server (router menu path in this issue)
