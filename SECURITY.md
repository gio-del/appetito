# Security

appetito lets an AI agent change and deploy code on your server without you watching. That is only reasonable if the **operating system**, not the model, decides what the agent can do. This page is the threat model and how to report a problem.

> **Use a dedicated machine.** The agent modifies and deploys code on the box automatically. Don't install appetito on a computer that holds anything you can't afford to lose or leak.

## What we defend against

1. **Prompt injection.** The agent reads issue text, logs, web pages and (in the second brain) your notes and forwarded material. Any of it may carry instructions written by someone else.
2. **Agent mistakes.** A wrong change, a broken service, a command that does more than intended.
3. **A compromised agent loosening its own limits** to do more next time.

We do **not** defend against: someone with root on the box, someone with your tracker password and your phone, a malicious upstream package or model provider, or an attacker already inside your tailnet with your devices' keys.

## The model

| Guarantee | Enforced by |
|---|---|
| The agent never has root or sudo | It runs as the unprivileged user `agent` with no sudo rules and no privileged groups (`guard/checks/security-audit`). No `agent-run` profile grants sudo. |
| The agent can't deploy on its own | It only pushes a branch to its own inbox. A fixed, root-owned **deploy runner** (`guard/bin/appetito-deploy`) decides what is merged and applied. Root only ever runs code from `guard/`, distro packages and systemd. |
| The agent can't run anything as root through a service | Units are validated by an **allowlist** (`guard/checks/unit-lint.js`) before install: never `User=root`, `NoNewPrivileges=yes`, no `+`/`!` exec prefixes, no `LoadCredential=`, no file redirections, no dependency on arbitrary system units, only `CAP_NET_BIND_SERVICE` when declared. |
| The agent can't loosen its limits | Everything that defines them lives in `guard/`; a change there **never auto-merges** (`guard/PROTECTED`, `guard/checks/branch-policy`). It waits in the tracker as "Change to protections — needs your tap", with the diff. |
| A proposal never becomes work without you | The daily suggestions and the second brain can only *propose*, through the tracker, each with its own token. Pending proposals live outside the repo, unreadable by `agent`. Approval happens on a separate origin served by guard code, with a one-time nonce the UI's code can't read; only the tracker server writes `Approved:` and the deploy runner rejects agent branches that touch it. |
| A broken deploy doesn't stay broken | After every merge the runner applies the release and runs the checks (tests, `security-audit`, `ports-check`, health URLs); on failure it reverts the merge (never rewriting history), re-applies the previous release, removes packages it had added, and opens an issue. |
| The agent and the brain reach only what they need | A per-uid nftables firewall lets `agent` and `brain` talk to loopback only; outside traffic goes through an egress proxy with **host allowlists** per user (`guard/firewall/`). The brain reaches only the model endpoint, the tracker's propose API and its Syncthing peers. |
| The brain can't touch the server | `brain` is its own user: no access to the server repo or issues, its fixed sorting rules are root-owned in `guard/brain/`, its runs are readable only by itself. Vault content is treated as untrusted. |
| The tracker isn't a soft target | Password login (scrypt, throttled), sessions in HttpOnly SameSite=Strict cookies, Origin and Host checks on every write, a strict CSP, no inline script, login and approvals on a separate origin. Everything listens on 127.0.0.1; Tailscale publishes HTTPS. |

The prompt also carries a red list (`guard/agent/rules.md`): it is a belt, not the braces.

## Known limits

- **Distro packages run maintainer scripts as root.** A service may ask the runner to install Debian/Ubuntu packages (`APT=` in its manifest). They come from your distro's signed repositories, and the checks fail a deploy that leaves a non-declared listener or a root service behind, but a package is trusted code.
- **The agent can change the tracker's UI and the worker** (that's how the system improves itself). The UI can't approve anything (see above), but it could show you misleading text. Read what the confirm page says before you tap.
- **Agent-created issues run automatically.** The agent may open follow-up issues for itself; only proposals from the suggestions and the brain need your approval.
- **Your model provider sees what the agent reads.** With Claude Code, that is Anthropic; with a local model, nobody.
- **Small local models** honour the same contract and limits, but they are not good at closing real issues.

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private vulnerability reporting on this repository (Security → Report a vulnerability), with what you found, how to reproduce it, and what an attacker gains. I'll answer within a week. This is a hobby project: there is no bounty, but you'll be credited if you want.
