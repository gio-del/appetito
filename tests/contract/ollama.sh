#!/bin/sh
# The openai adapter's contract against a real Ollama with a small model, all in disposable
# containers (Ollama + a node box with opencode, run as its user node: agent-run refuses root). Checks the contract, not the model's skill
# (CONTRACT_ONLY=1). Removes everything it created, the Ollama image included (they are big).
#   tests/contract/ollama.sh [MODEL]     (default qwen2.5:0.5b)
set -eu
MODEL=${1:-qwen2.5:0.5b}
OLLAMA_IMG=ollama/ollama:0.6.8 NODE_IMG=node:22-bookworm-slim
OPENCODE_VERSION=$(sed -n 's/^OPENCODE_VERSION=//p' "$(dirname "$0")/../../install.sh")
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
N=appetito-contract-$$
cleanup() {
	docker rm -f "$N-ollama" "$N-box" >/dev/null 2>&1 || true
	docker network rm "$N" >/dev/null 2>&1 || true
	docker volume rm "$N-models" >/dev/null 2>&1 || true
	[ -n "${KEEP_IMAGE:-}" ] || docker rmi "$OLLAMA_IMG" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$N" >/dev/null
docker run -d --name "$N-ollama" --network "$N" -v "$N-models:/root/.ollama" "$OLLAMA_IMG" >/dev/null
for _ in $(seq 1 30); do docker exec "$N-ollama" ollama list >/dev/null 2>&1 && break; sleep 1; done
echo "== pull $MODEL"
docker exec "$N-ollama" ollama pull "$MODEL" >/dev/null 2>&1
echo "== contract (opencode $OPENCODE_VERSION)"
docker run --rm --name "$N-box" --network "$N" -v "$ROOT/guard:/src/guard:ro" -v "$ROOT/tests:/src/tests:ro" \
	-e APPETITO_OPENAI_BASE_URL="http://$N-ollama:11434/v1" -e APPETITO_OPENAI_MODEL="$MODEL" \
	-e CONTRACT_ONLY=1 -e CONTRACT_TIMEOUT="${CONTRACT_TIMEOUT:-900}" "$NODE_IMG" sh -c "
		npm install -g --no-fund --no-audit opencode-ai@$OPENCODE_VERSION >/dev/null 2>&1 &&
		su node -s /bin/sh -c 'cd /src && sh tests/contract/agent-run.sh openai'"
