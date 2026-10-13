# How appetito works

appetito turns one Linux box (Debian 13 or Ubuntu 24.04, amd64 or arm64, systemd) into a home server that grows itself. You write what you want as markdown issues; an agent implements them; a fixed, root-owned runner decides what gets deployed. The OS enforces the limits, not the model.

```
 monitor ─┐                                     ┌──────────── owner (phone, tracker PWA)
 suggest ─┼─► issues/ (proposed → open) ◄───────┤ approve / reject / move / tap guard changes
 brain  ──┘            │                        └──────────────────────────┐
                       ▼                                                   │
               worker (user agent) ── agent-run ─► branch agent/NNN ─► inbox.git
                                                                           │
                         deploy runner (root, fixed, guard/) ◄─────────────┘
                         branch policy → merge (auto | approve) → apply → checks
                         → ok: issue closed on main   → fail: rollback + monitor issue
```

## Users and directories

| User | Runs | Can write |
|---|---|---|
| `root` | deploy runner, issue autocommit, firewall, apply of services | everything (only fixed code in `guard/`) |
| `agent` | worker, daily suggestions | its clone `/var/lib/appetito/agent/work`, its bare repo `/var/lib/appetito/agent/inbox.git` |
| `tracker` | the tracker web app | `issues/` in the server repo, `/var/lib/appetito/tracker`, request files for the runner |
| `brain` | Syncthing, vault autocommit, sorting, proposals | the vault `/var/lib/appetito/brain/vault` |
| `appetito` | monitor, lint, housekeeping | `issues/` (monitor issues), `/var/lib/appetito/state` |
| one per service | each service the agent adds (`services/<name>/`) | its own data dir |

Nobody but root has sudo. `agent` and `brain` have no access to each other's files, and `brain` can't read the server repo.

- `/opt/appetito/repo` — **the server repo** (your clone of appetito; branch `main` is what runs). Owned by root; `issues/` is group-writable by `appetito-issues` (`tracker`, `appetito`). World-readable: no secrets live here.
- `/etc/appetito/appetito.env` — settings written by the installer (backends, merge gate, network). `/etc/appetito/secrets/` — tokens and keys, one file each, owned by the user that needs it.
- `/var/lib/appetito/` — state: runs, logs, settings written by the tracker (`settings.env`), deploy state.

## The loop

1. **Work arrives as issues.** The owner writes one in the tracker, or approves a **proposal**: the monitor, the daily suggestions and the second brain can only *propose* (`issues/proposed/`), through the tracker's API, each with its own token. The tracker stamps `Source:` from the token and, on approval, `Approved: YYYY-MM-DD`. Proposals always need the owner's tap, whatever the merge gate.
2. **The worker** (`core/worker/`, timer, user `agent`) picks the best open issue (`Status: todo|in-progress`, `Blocked on: -`, not an epic; `monitor` issues first; a proposal only with `Approved:`), resets its clone to `main`, creates `agent/NNN-<slug>`, and calls `agent-run` with the `edit-repo` profile and the fixed rules (`guard/agent/rules.md`). The agent edits code and the issue (closing it moves it to `issues/done/`), commits, and the worker pushes the branch to `inbox.git`. Quota gate, attempts (3, then the issue goes to the owner) and denied actions are handled by the worker from the normalized transcript.
3. **The deploy runner** (`guard/bin/appetito-deploy`, root, systemd path + timer) fetches new branches and applies the **branch policy** (`guard/checks/branch-policy`):
   - a change under any path in `guard/PROTECTED` → never auto-merged: the tracker shows *Change to protections — needs your tap* with the diff;
   - a change to `issues/proposed/`, or one that adds or edits `Approved:` / `Source:` lines → rejected;
   - anything else → merged when the **merge gate** is `auto` (default), or after the owner's tap when it is `approve`.
4. **Apply and check.** The runner merges into `main`, applies the known directories (`core/` → `/opt/appetito/core`, units, `services/*`), and runs the checks: unit tests, `security-audit`, `ports-check`, each service's health URL. **On failure it rolls back**: `git revert` of the merge (history is never rewritten), re-apply the previous tree, and the monitor opens an issue with the log.
5. **The monitor** (`core/monitor/`) verifies continuously: job results, units, health URLs, probes in `tests/probes/`. A failure becomes a `monitor` issue (deduplicated, closed automatically when green), which the worker fixes first.

## What the agent can change without asking

Everything outside `guard/`: the tracker, the worker, the monitor, the issue tools, the second brain's jobs, services. It may improve its own engine. It may **not** loosen its own limits: the runner, the checks, `agent-run` and its permission profiles, the rules prompt, the firewall, the brain's fixed sorting rules and the list of protected paths are all under `guard/`, and changes there wait for the owner.

## Services

A service is a folder `services/<name>/` with a `service.env` manifest the runner understands (no free-form root scripts):

```sh
NAME=vaultwarden
USER=vaultwarden            # system user created by the runner, owns /var/lib/<name>
APT="sqlite3"               # Debian/Ubuntu packages to install
PORTS="127.0.0.1:8222"      # what it may listen on (checked by ports-check)
HEALTH=http://127.0.0.1:8222/alive
LOW_PORT=no                 # yes → CAP_NET_BIND_SERVICE, nothing else
```

plus systemd units (`*.service`, `*.timer`) that `guard/checks/unit-lint` validates: never `User=root`, `NoNewPrivileges=yes`, no capabilities but `CAP_NET_BIND_SERVICE` when `LOW_PORT=yes`, hardening options set. Anything a service needs to download (a release binary) is fetched by an `ExecStartPre` running as the service's own user, never as root. Backups are encrypted with `age`.

## Network

Default: Tailscale. Everything listens on `127.0.0.1`; `tailscale serve` publishes the tracker over HTTPS (so it installs as a PWA). The Tailscale policy template in `guard/tailscale/` ships with `tests`. With `--no-tailscale` everything stays on localhost and exposing it is your choice (WireGuard, Cloudflare Tunnel, …).

Per-uid firewall (`guard/firewall/`, nftables): `agent` reaches only the model endpoint and package mirrors; `brain` only the tracker's propose API, the model endpoint, its Syncthing peers and (optional) CalDAV.

## Agents

All model calls go through `agent-run` (`docs/agent-run.md`): Claude Code or any OpenAI-compatible endpoint, including a local model, chosen per job.
