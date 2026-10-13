<p align="center"><img src="core/tracker/public/icon.svg" width="72" alt=""></p>

<h1 align="center">appetito</h1>

<p align="center"><b>A self-hosted second brain that evolves itself.</b><br>
You write what you want as issues. An agent builds it on your server. The OS keeps it in its lane.</p>

<p align="center"><img src="docs/media/demo.gif" width="320" alt="Moving 'Add Vaultwarden' to To do on a phone: the worker picks it up, works through it, and the issue closes; Vaultwarden opens."></p>

> ⚠️ **The agent modifies and deploys code on your server automatically. Use a dedicated machine.** Read [SECURITY.md](SECURITY.md) first.

appetito is a **seed**, not a product: you clone it, it becomes yours, and from then on your server grows by working through markdown issues. It ships with:

- a **tracker** (a board you install as an app on your phone) over plain `issues/*.md` files;
- a **worker** that picks the next issue, runs an agent on it in its own branch, and hands the result to a fixed **deploy runner** that merges, applies, checks and rolls back;
- a **monitor** that turns failures into issues the worker fixes first;
- **daily proposals** of improvements, and a **second brain**: an Obsidian vault synced to your devices, sorted by an agent, that can propose work for the server — proposals become work only when you approve them;
- a **starter backlog**: a password manager, ad blocking, a dashboard, a calendar, off-site backups. Move one to *To do* and watch.

It works with **Claude Code or any OpenAI-compatible endpoint, including a local model on your own machine** ([docs/agent-run.md](docs/agent-run.md)).

## Quickstart

On a **dedicated** Debian 13 or Ubuntu 24.04 box (amd64 or arm64), with a [Tailscale](https://tailscale.com) account:

```sh
git clone https://github.com/gio-del/appetito
cd appetito
sudo ./install.sh        # asks for a Tailscale auth key and a Claude Code token (`claude setup-token`)
```

Then open the link it prints to set your password, open the tracker on your phone, and move **Add Vaultwarden** to *To do*. The worker starts at the next :07 or :37, or right away with *Start now*.

No Tailscale? `sudo ./install.sh --no-tailscale` keeps everything on `127.0.0.1` ([docs/network.md](docs/network.md)). A local model? `sudo ./install.sh --backend openai --openai-url http://127.0.0.1:11434/v1 --openai-model qwen2.5-coder:7b`.

## How it works

```
 you (phone) ── issues ──► worker (user agent, no sudo) ── branch ──► deploy runner (root, fixed)
                  ▲                                                      │ merge → apply → checks
 monitor ─────────┤  failures                                            │ ok: issue closed
 suggestions ─┐   │                                                      │ fail: roll back + issue
 second brain ┴─► proposals ── your tap ─┘
```

The agent can improve everything — services, the tracker's UI, the worker, the monitor — except what limits it. That lives in `guard/` (the deploy runner, the checks, the agent's permissions and rules, the firewall, the second brain's fixed rules, the list of protected paths), and a change there waits for your tap in the tracker. Details in [docs/architecture.md](docs/architecture.md).

## Security model, in short

- The agent runs as an unprivileged user with **no sudo**, in its own clone. It can't deploy: it pushes a branch, and a fixed root-owned runner decides.
- Units it writes are checked against an **allowlist** before install; nothing it writes ever runs as root.
- **Changes to the protections never auto-merge.** **Proposals never run without your approval**, given on a confirm page the agent's code can't drive.
- A deploy that fails its checks is **rolled back** and becomes an issue.
- `agent` and `brain` reach the network only through an **egress proxy with host allowlists**; the second brain can't see the server repo.
- Everything listens on localhost; Tailscale publishes HTTPS to your devices only.

The full threat model, and what appetito does **not** protect against, is in [SECURITY.md](SECURITY.md).

## What it does not do

- It is not a hosted service and has no upgrade path: it's your repo. To take upstream changes, add this repo as a remote and ask the agent to merge, like any other issue.
- It doesn't promise quality from small local models: they honour the same contract and limits, but closing real issues needs a capable model.
- It doesn't manage your accounts, DNS, router or payments: those steps become `(HITL)` steps the agent writes for you.
- It doesn't run on macOS or Windows, or without systemd.
- It doesn't do multi-user, high availability or anything you'd call production.

## Running it on an old phone

That's where it started. It's unsupported and root is not included, but here are the traps: [docs/android-phone.md](docs/android-phone.md).

## Development

`make check` (personal values, secrets over the whole history, shellcheck), `make test` (unit tests), `make e2e` (a disposable systemd container per run: installer and real scenarios; see `tests/e2e/run`). The seed's own work is tracked in `dev/issues/`.

Licence: [Apache-2.0](LICENSE).
