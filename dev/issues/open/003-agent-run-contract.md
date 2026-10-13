# agent-run contract and adapters
Opened: 2026-10-13
Blocked on: -
Status: todo
Priority: urgent
Labels: gate-4, guard

PRD §3. Executable `guard/agent-run/agent-run --prompt FILE --dir DIR --profile read-only|edit-repo|vault-edit --backend NAME --out DIR` → exit code, `transcript.jsonl` (normalized: `{t, kind: tool|text|result|limit, tool: {category, status}}`), `usage.json` (tokens, cost if known, duration). No profile grants sudo.

- [ ] Spec in `docs/agent-run.md`
- [ ] `claude-code` adapter (headless `claude -p`, stream-json → normalized; `rate_limit_event` → limit records)
- [ ] `openai` adapter: opencode against any OpenAI-compatible endpoint (Ollama / llama.cpp / vLLM)
- [ ] Backend configurable per job (`APPETITO_BACKEND_<JOB>`)
- [ ] Contract test suite run against every adapter (fake backend + real Ollama small model in a container)

Acceptance: contract tests green for both adapters; nothing outside `guard/agent-run` parses vendor formats.
