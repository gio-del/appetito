# Add a dashboard (Homepage) with system status

> Not yet run end to end in appetito's own e2e sandbox (Vaultwarden, #001, is). It should work; if the agent struggles, refine this text.

Opened: 2026-10-13
Blocked on: -
Status: backlog
Priority: medium
Labels: service, dashboard

One page with links to every service and the server's health: CPU, memory, disk, uptime, the worker's state.

## What
- A service `homepage` running [Homepage](https://github.com/gethomepage/homepage) (pinned release, built or fetched by the service user; Node.js from the distro is fine), on `127.0.0.1:3002`.
- Cards for the tracker and every service in `services/` (generated from their manifests, so a new service shows up by itself), a resources widget, and a card with the worker's status from `/var/lib/appetito/worker/status.json` (read-only).
- Installable as an app on the phone (`display: standalone`); `HOMEPAGE_ALLOWED_HOSTS` lists exactly the hosts used.

## Acceptance criteria
- Health URL answers after deploy; `ports-check` sees only `127.0.0.1:3002`.
- Adding a test service folder adds its card without touching the dashboard's config by hand (a test proves it).
- No Docker socket, no secrets in its config.

## Steps
- [ ] Service folder, install/fetch script, config generated from `services/*/service.env`, unit, test
- [ ] (HITL) With Tailscale: publish it with the `tailscale serve` command written here (needs root)
