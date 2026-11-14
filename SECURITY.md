# Security

## Model with "Security enabled" (default)

`HS_SECURITY_ENABLED` in `device/edge/home-server.env` (installed as `/etc/home-server.env`) is the only switch. The installer writes `true`; a missing value or anything other than `false` also means `true`. It is read once at start: after changing it, restart the `ops` service and the next `ops-auto` run picks it up. It is deliberately not a web setting.

When it is on:

- **The agent has no sudo.** The `ops` session and every `ops-auto` run start under `setpriv --no-new-privs`, so `sudo` and setuid binaries give no privileges. The agent cannot change the system itself.
- **The deploy is a separate process.** `device/edge/deploy` only sends a request; the `deploy-worker` service, which has its own permissions, installs the change and then checks that the services that were running still are. If installing or the check fails, it redeploys the last good commit and notifies you.
- **Protected files.** A hook (`hs-protect-guard`) asks for the owner's OK before the agent writes secrets (`~/.secrets`), sudoers, `home-server.env`, scripts and service definitions that run as root, the deploy and the guards themselves. In an unattended run a request is a refusal.
- **Network.** Services listen on `127.0.0.1`; only Caddy exposes sites, and optional services are off until you enable them. Note that with Tailscale in userspace mode a localhost port is reachable from your whole tailnet, so restrict the tailnet with its policy (`tailscale/policy.template.hujson`). `scripts/security-audit` checks the result.
- **Unattended runs.** Headless agent runs (`ops-auto`) are started without web tools and without MCP servers.

## What it does not protect against

- The agent can still write the repository and anything the server's user owns outside the protected list. A bad change that passes the checks and the post-deploy verification will be deployed. Read what it does.
- The OK for a protected file is given by whoever can drive the interactive session: protect that account (2FA).
- A compromised Claude account, tailnet, or the machine's physical access are out of scope.
- The installer gives the server user `NOPASSWD` sudo. The no-new-privs restriction applies to the agent processes, not to a login shell you open as that user.
- With `HS_SECURITY_ENABLED=false` none of the above applies.

## Reporting a problem

Open a private security advisory on this repository's GitHub page (Security → Report a vulnerability). Please do not file public issues for vulnerabilities. Include the commit, your distribution and steps to reproduce.
