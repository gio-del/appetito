# appetito

A small self-hosted server that an AI agent maintains by working through markdown issues. You write what you want as an issue; the agent builds it; automatic checks decide whether it gets deployed.

It is the public copy of the author's own home server. Every publication is installed from zero on a stock Debian 13 and Ubuntu 24.04 in CI (`.github/workflows/install.yml`) before it counts as good.

## Quick start

On a clean Debian 13 or Ubuntu 24.04 machine you control:

```sh
git clone https://github.com/<owner>/<repo>.git
cd <repo>
sudo ./install.sh --user hs
```

`--user` is the Linux user that will own the server (created if missing). Add `--no-tailscale` to skip Tailscale: nothing then filters the network, so everything, Caddy included, listens on `127.0.0.1` only (reach it with an SSH tunnel). `--listen-lan` (only with `--no-tailscale`) lets Caddy's dashboard and ports 80/8443 listen on every interface: anyone who can reach the machine can then reach them, so use it only behind a firewall you control. `--dry-run` prints every command without running it. The script is safe to run again.

It installs the packages, starts [runit](http://smarden.org/runit/) as a system service, writes `device/edge/home-server.env` from its template, puts the copy in `~hs/home-server`, runs the first deploy and enables the base services: the issue tracker, Caddy and Syncthing (plus Tailscale unless skipped). Optional services stay off. Everything listens on `127.0.0.1`.

Afterwards:

1. Log in as that user and open `~/home-server`.
2. With Tailscale: run `sudo tailscale up` once, then put your tailnet name and IPs in `device/edge/home-server.env` (see the comments in `home-server.env.example`).
3. The tracker is served by Caddy on port 8444. Until a real certificate is issued for your tailnet name, Caddy uses a self-signed placeholder.

## How it works

- **Issues are files.** `issues/open/NNN-slug.md`; the tracker is a web board over them, usable from a phone. Format: `issues/README.md`.
- **The agent works the queue.** `ops-auto` picks one issue per run, edits the repo, and finishes by fixing it, handing a question to you, or leaving a progress note. The interactive session `ops` runs [Claude Code](https://claude.com/claude-code) as the server's user; you need to install it and sign in yourself (2FA on that account is strongly recommended).
- **Checks gate the deploy.** `device/edge/check` runs syntax checks, shellcheck and the test suite; `device/edge/deploy` refuses to install when they fail.

## Security model in short

With `HS_SECURITY_ENABLED=true` (the default the installer writes) the agent has no `sudo`, the deploy is a separate process that rolls back if verification fails, and secrets and root-run scripts are protected files. Details, and what it does not protect against, in [SECURITY.md](SECURITY.md). Run `scripts/security-audit` after any security-relevant change.

## What it does not do

- It is not a hardened multi-user system: one owner, one agent.
- No Docker; services are plain processes under runit.
- **The Android phone** the author runs it on is not a supported target: the installer refuses it (`device/edge/install.sh` is the author's own phone installer, unsupported).
- **The tracker and the app's texts are in Italian.** An English interface is not planned yet; this README, SECURITY.md and the installer are in English.

## License

[Apache License 2.0](LICENSE).
