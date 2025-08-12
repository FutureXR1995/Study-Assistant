#!/usr/bin/env bash
set -euo pipefail
SLOT="${1:-morning}"
cd "$(dirname "$0")/.."
BODY=$(printf '{"version":"toeic-12d-v1","slot":"%s"}' "$SLOT")
printf "%s" "$BODY" | curl -sS -X POST http://localhost:3000/api/plan/trigger -H "Content-Type: application/json" --data-binary @- >/dev/null 2>&1 || true
