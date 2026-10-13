# Services

Each folder here is one service on this server (a password manager, a DNS blocker, a dashboard…). The agent adds them by working on issues; the **deploy runner** (root, fixed code in `guard/`) is what actually installs them, and only in the ways described here. Nothing in a service folder ever runs as root.

```
services/<name>/
  service.env          the manifest (below)
  <name>.service       systemd unit(s): <name>.service, <name>-<anything>.service / .timer / .path
  …                    config files, scripts, a www/ folder: shipped read-only in the release
```

## `service.env`

`KEY=value` lines, never run by a shell (quote values with spaces; no `$`, backticks or `;`).

| Key | Meaning |
|---|---|
| `NAME` | the folder name |
| `USER` | system user the runner creates for it (default: `NAME`); owns `/var/lib/<name>` (mode 750) |
| `APT` | Debian/Ubuntu packages the runner installs (`APT="sqlite3 python3"`); a failed deploy purges the ones it added |
| `PORTS` | where it may listen: `127.0.0.1:8222`, `0.0.0.0:53/udp`… `ports-check` fails the deploy on anything else |
| `HEALTH` | `http://127.0.0.1:PORT/path` that must answer 2xx/3xx after every deploy (the monitor keeps checking it) |
| `LOW_PORT` | `yes` lets the unit use `CAP_NET_BIND_SERVICE` (ports below 1024), and nothing else |

The runner also creates `/etc/appetito/services/<name>/` (root:`<user>`, 750) for secrets **the owner** puts there (an admin token, an `age` public key…). Never put secrets in the repo.

## Units

`guard/checks/unit-lint.js` validates every unit with an allowlist before the runner installs it. In short:

- `User=<the service's user>`, `NoNewPrivileges=yes`, an `ExecStart=`. No `+`/`!` prefixes, no `LoadCredential=`, no `StandardOutput=file:`, no `SupplementaryGroups=`, no `DynamicUser=`.
- `StateDirectory=`, `CacheDirectory=`, `LogsDirectory=`, `RuntimeDirectory=`: only `<name>` or under it.
- `EnvironmentFile=`: only `/etc/appetito/appetito.env` or files under `/etc/appetito/services/<name>/`.
- `After=`/`Wants=`/`Requires=`: `network-online.target` and friends, or this repo's own units.
- `[Install] WantedBy=multi-user.target` (long-running) or `timers.target` (a `.timer`).

Run `node guard/checks/unit-lint.js .` before committing. Harden what you can (`ProtectSystem=strict`, `ReadWritePaths=/var/lib/<name>`, `PrivateTmp=yes`, `ProtectHome=yes`…).

## Downloads

A release binary or an image layer is fetched **by the service's own user**, e.g. in an `ExecStartPre=` script that downloads to `/var/lib/<name>`, checks a SHA-256 you pinned in the repo, and skips the download when the right version is already there. The runner never downloads anything for a service.

## Backups

Backups are encrypted with `age` to a public key the owner puts in `/etc/appetito/services/<name>/backup.age.pub`; the private key never touches the server.

## Example

```ini
# services/hello/service.env
NAME=hello
APT=python3
PORTS=127.0.0.1:8090
HEALTH=http://127.0.0.1:8090/
```

```ini
# services/hello/hello.service
[Unit]
Description=hello: a static page
After=network-online.target

[Service]
User=hello
Group=hello
ExecStart=/usr/bin/python3 -m http.server 8090 --bind 127.0.0.1 --directory /opt/appetito/current/services/hello/www
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
```
