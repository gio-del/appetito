# agent-run: the agent contract

Nothing in appetito talks to an agent backend directly. Every job that needs a model (the worker, daily suggestions, the second brain's sorting) calls one executable, `guard/agent-run/agent-run`, and reads only what it writes. Swapping Claude Code for a local model is a config change, not a code change.

```
agent-run --prompt FILE --dir DIR --profile PROFILE --out DIR
          [--system FILE] [--job NAME] [--backend NAME] [--timeout SECONDS]
```

| Input | Meaning |
|---|---|
| `--prompt` | The task, as a file. |
| `--system` | Fixed rules appended to the backend's system prompt (red list, trust rules). |
| `--dir` | Working directory. The backend runs there, as the calling user. |
| `--profile` | `read-only`, `edit-repo` or `vault-edit` (`guard/agent-run/profiles/`). |
| `--job` | Job name, used to pick the backend (`APPETITO_BACKEND_<JOB>`). |
| `--backend` | Force a backend: `claude-code`, `openai`, `fake`. |
| `--timeout` | Seconds before the whole process group is killed (default 3600). |

agent-run refuses to run as root, and **no profile ever grants sudo**: the calling user (`agent`, `brain`) has none, and the OS is the boundary. Profiles only decide what the backend is *offered*:

| Profile | Edit files | Shell | Web | Used by |
|---|---|---|---|---|
| `read-only` | no | no | no | daily suggestions |
| `edit-repo` | yes | yes | yes | the worker (in its own clone, as `agent`) |
| `vault-edit` | yes | yes | no | the second brain's sorting (as `brain`) |

## Outputs (in `--out`)

- **`transcript.jsonl`**: the normalized transcript, one JSON object per line, each with `t` (epoch ms) and `kind`:
  - `{"kind":"start","backend":"claude-code","model":"…"}`
  - `{"kind":"tool","id":"…","name":"Bash","category":"shell","status":"started|ok|error"}` — `category` is one of `read`, `search`, `edit`, `shell`, `web`, `agent`, `plan`, `other`. Tool **inputs are never recorded** (the live page shows what kind of step is running, not its content).
  - `{"kind":"text","chars":123}` — the model wrote text (length only).
  - `{"kind":"denied","name":"Bash","category":"shell","detail":"sudo systemctl …"}` — an action the backend refused under the profile. `detail` is at most 200 characters; it is shown to the owner as data, never executed.
  - `{"kind":"limit","window":"five_hour","utilization":0.42,"resets_at":1791921000,"status":"allowed|rejected"}` — a usage window reported by the backend (Claude's `rate_limit_event`). The quota gate reads these.
  - `{"kind":"result","status":"success|error|limit|timeout","turns":12,"tools":30,"denied":0,"text":"final reply"}` — always the last line.
- **`usage.json`**: `{backend, model, profile, input_tokens, output_tokens, cache_read_tokens, cost_usd, turns, tools, denied, duration_ms, status}`; unknown values are `null` (a local model has no cost).
- **`final.txt`**: the final reply.
- `raw.jsonl`, `stderr.txt`: the backend's own output, mode 600, for debugging by its owner. Nothing in appetito parses them.

Exit code: `0` success, `1` failure, `2` usage error, `3` a backend limit stopped the run, `4` timeout.

## Backends

Chosen per job: `--backend`, else `APPETITO_BACKEND_<JOB>` (e.g. `APPETITO_BACKEND_BRAIN_SORT=openai`), else `APPETITO_BACKEND`, else `claude-code`. Settings live in `/etc/appetito/appetito.env`.

### `claude-code`
Headless `claude -p` with `--output-format stream-json`. The profile becomes `--allowedTools` / `--disallowedTools` (everything not granted is disallowed, so a headless run gets a denial, not a prompt nobody answers) and a permission mode: `acceptEdits` for editing profiles, `default` for `read-only`. `APPETITO_CLAUDE_PERMISSION_MODE=auto` adds Claude's own classifier as an extra belt where your plan offers it; bypass mode is refused. Other settings: `APPETITO_CLAUDE_MODEL`, `APPETITO_CLAUDE_MAX_BUDGET_USD` (default 10), `APPETITO_CLAUDE_BIN`. Credentials are those of the calling user (`~agent/.claude`).

### `openai`
[opencode](https://opencode.ai) against any OpenAI-compatible endpoint: Ollama, llama.cpp's server, vLLM, or a hosted API. Settings: `APPETITO_OPENAI_BASE_URL` (e.g. `http://127.0.0.1:11434/v1`), `APPETITO_OPENAI_MODEL`, `APPETITO_OPENAI_API_KEY_FILE` (optional), `APPETITO_OPENCODE_BIN`. The profile becomes opencode's permission config (`edit`, `bash`, `webfetch`: `allow` or `deny`). No quality promise for small local models: they honour the contract, closing real issues needs a capable model.

### `fake`
A scripted backend for tests (`APPETITO_FAKE_SCRIPT`), so every job can be tested deterministically without a model.

## Adding a backend

Write `guard/agent-run/adapters/<name>.js` exporting `run({prompt, system, dir, profile, out, timeout, transcript, env})`, map the profile to the backend's own permission system (deny by default), emit the records above through `transcript`, and make `tests/contract/agent-run.sh <name>` pass. Adapters live under `guard/`: changing one needs the owner's tap.
