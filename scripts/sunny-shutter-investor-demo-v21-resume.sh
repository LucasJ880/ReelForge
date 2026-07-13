#!/usr/bin/env bash
# Resume Sunny Shutter V2.1 after storyboard review: submit → wait → assemble → publish.
# Retries submit until Seedance preflight passes (usually needs China VPN).
set -euo pipefail
cd "$(dirname "$0")/.."

run_phase() {
  echo ""
  echo ">>> $1"
  npx tsx scripts/sunny-shutter-investor-demo-v21.ts --phase="$1"
}

echo "=== Sunny Shutter V2.1 resume (storyboard → final + publish) ==="

until run_phase submit; do
  echo "$(date '+%H:%M:%S') — submit blocked (无法连接 BytePlus 国际 Ark；网络恢复后自动重试)…"
  sleep 30
done

run_phase wait
run_phase assemble
run_phase publish

echo ""
echo "=== Done. Check tmp/sunny-shutter-investor-demo-v21/final.mp4 and /personal/videos ==="
