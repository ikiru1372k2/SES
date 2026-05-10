#!/bin/bash
cd "$(dirname "$0")"

# Kill the PID we recorded (if any), then sweep any orphan uvicorn
# instances bound to main:app — covers stale processes from earlier runs
# where the PID file was lost.
if [ -f ai-service.pid ]; then
    PID=$(cat ai-service.pid)
    kill -9 "$PID" 2>/dev/null && echo "Killed recorded PID $PID"
    rm -f ai-service.pid
fi

ORPHANS=$(pgrep -f "uvicorn main:app" || true)
if [ -n "$ORPHANS" ]; then
    echo "Sweeping orphan uvicorn processes: $ORPHANS"
    echo "$ORPHANS" | xargs -r kill -9 2>/dev/null
fi

echo "✓ AI service stopped"
