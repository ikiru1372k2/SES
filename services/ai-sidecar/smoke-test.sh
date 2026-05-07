#!/bin/bash
# End-to-end smoke test.
set -e
BASE="http://localhost:8000"

echo "═══════════════════════════════════════════"
echo "  SES AI Service — Smoke Test"
echo "═══════════════════════════════════════════"

if [ ! -f /tmp/test_ses.xlsx ]; then
    echo "Creating /tmp/test_ses.xlsx..."
    python3 -c "
import pandas as pd
pd.DataFrame({
    'Project_ID':    ['P001','P002','P003','P004'],
    'Project_Name':  ['Alpha','Beta','Gamma','Delta'],
    'Planned_Hours': [100, 200, 150, 300],
    'Actual_Hours':  [120, 180, 200, 290],
    'Status':        ['Active','At Risk','Active','Active']
}).to_excel('/tmp/test_ses.xlsx', index=False)
"
fi

echo ""
echo "── 1. Health check ──"
curl -s "$BASE/health" | python3 -m json.tool

echo ""
echo "── 2. Upload ──"
UPLOAD=$(curl -s -X POST "$BASE/pilot/upload" -F "file=@/tmp/test_ses.xlsx")
echo "$UPLOAD" | python3 -m json.tool
SESSION_ID=$(echo "$UPLOAD" | python3 -c "import sys, json; print(json.load(sys.stdin)['session_id'])")
echo "  → session_id: $SESSION_ID"

echo ""
echo "── 3. Generate (~5–10s) ──"
GEN=$(curl -s -X POST "$BASE/pilot/generate" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SESSION_ID\",\"engine\":\"over-planning\",\"description\":\"Flag rows where Actual_Hours exceed Planned_Hours by more than 15 percent\"}")
echo "$GEN" | python3 -m json.tool

echo ""
echo "── 4. Cleanup ──"
curl -s -X POST "$BASE/pilot/cleanup" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$SESSION_ID\"}" | python3 -m json.tool

echo ""
echo "═══════════════════════════════════════════"
echo "  ✓ Smoke test complete."
echo "═══════════════════════════════════════════"
