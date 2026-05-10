#!/bin/bash
# Start the SES AI Sidecar in the background.
#
# Pulls the analytics models too so the agent loop and embeddings layer
# both work out of the box. Model tags listed below — pin to digests
# after the first pull to lock the binary against `latest` rebases.
#
#   ollama show --modelfile qwen2.5-coder:7b-instruct | grep digest
#   ollama show --modelfile llama3.2:3b       | grep digest
#   ollama show --modelfile nomic-embed-text           | grep digest
#
# Then put the resulting digests in start-ai.sh so re-pulls are deterministic.

set -e
cd "$(dirname "$0")"

# Models the sidecar uses
RULE_GEN_MODEL="${AI_MODEL:-qwen2.5:7b}"
ENHANCE_MODEL="${AI_ENHANCE_MODEL:-llama3.2:3b}"
AGENT_MODEL="${AI_AGENT_MODEL:-qwen2.5-coder:7b-instruct}"
EMBED_MODEL="${AI_EMBED_MODEL:-nomic-embed-text}"

if [ -d venv ]; then
  # shellcheck disable=SC1091
  source venv/bin/activate
fi

echo "Checking Ollama is reachable..."
if ! curl -s http://localhost:11434 > /dev/null; then
  echo "ERROR: Ollama not running on :11434. Start it with: sudo systemctl start ollama"
  exit 1
fi

ensure_model() {
  local m="$1"
  if ! ollama list | awk '{print $1}' | grep -qx "$m"; then
    echo "Pulling $m ..."
    ollama pull "$m"
  else
    echo "✓ $m present"
  fi
}

ensure_model "$RULE_GEN_MODEL"
ensure_model "$ENHANCE_MODEL"
ensure_model "$AGENT_MODEL"
ensure_model "$EMBED_MODEL"

# Ollama parallelism — each parallel slot = one full model copy in VRAM.
# Tune in environment; default 4 for mid-range GPU boxes.
export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-4}"

pip install -q fastapi uvicorn python-multipart duckdb

if [ -f ai-service.pid ] && kill -0 "$(cat ai-service.pid)" 2>/dev/null; then
    echo "AI sidecar already running (PID $(cat ai-service.pid))"
    echo "Stop it first: ./stop-ai.sh"
    exit 1
fi

echo "Starting AI sidecar on http://0.0.0.0:8000 (NUM_PARALLEL=$OLLAMA_NUM_PARALLEL)..."
nohup uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 > ai-service.log 2>&1 &
echo $! > ai-service.pid

for i in $(seq 1 30); do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then break; fi
    sleep 1
done

if curl -s http://localhost:8000/health > /dev/null; then
    echo ""
    echo "✓ AI sidecar started (PID $(cat ai-service.pid))"
    echo ""
    echo "Health:    curl http://localhost:8000/health"
    echo "Analytics: curl http://localhost:8000/analytics/health"
    echo "Logs:      tail -f $(pwd)/ai-service.log"
    echo "Stop:      $(pwd)/stop-ai.sh"
else
    echo "✗ Service did not respond. Check logs: tail -50 ai-service.log"
    exit 1
fi
