# agent-run contract and adapters
Opened: 2026-10-13
Closed: 2026-10-14
Status: done
Priority: urgent
Labels: gate-4, guard

PRD §3. Executable `guard/agent-run/agent-run --prompt FILE --dir DIR --profile read-only|edit-repo|vault-edit --backend NAME --out DIR` → exit code, `transcript.jsonl` (normalized: `{t, kind: tool|text|result|limit, tool: {category, status}}`), `usage.json` (tokens, cost if known, duration). No profile grants sudo.

- [x] Spec in `docs/agent-run.md`
- [x] `claude-code` adapter (headless `claude -p`, stream-json → normalized; `rate_limit_event` → limit records)
- [x] `openai` adapter: opencode against any OpenAI-compatible endpoint (Ollama / llama.cpp / vLLM)
- [x] Backend configurable per job (`APPETITO_BACKEND_<JOB>`)
- [x] Contract test suite run against every adapter (fake backend + real Ollama small model in a container)

Acceptance: contract tests green for both adapters; nothing outside `guard/agent-run` parses vendor formats.

## Progress

- 2026-10-13: `tests/contract/ollama.sh` (new: Ollama 0.6.8 + opencode in disposable containers, run as a non-root user, cleans up the image) → `contract: openai ok` with qwen2.5:0.5b, `CONTRACT_ONLY=1`. The fake backend is green in `make test`. Nothing outside `guard/agent-run` parses vendor formats (grep for stream-json / rate_limit_event / tool_use).
- Left: `tests/contract/agent-run.sh claude-code` on its own (the adapter is exercised by every first-issue e2e, but the contract script hasn't run against it). Short run, after the Pro quota's five-hour window is back under 50%. Then close.
- 2026-10-14: `tests/e2e/run --scenario contract` → `contract: claude-code ok` (as agent, in the worker's environment: egress proxy and firewall). Both adapters green. Closed.
