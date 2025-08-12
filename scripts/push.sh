#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 morning|evening [toUserId]" >&2
  exit 1
fi

TYPE="$1"
TO="${2:-}"

cd "$(dirname "$0")/.."

if [[ -z "${TO}" ]]; then
  # fallback to DEFAULT_LINE_USER_ID
  if [[ -f .env ]]; then
    # shellcheck disable=SC2046
    export $(grep -E '^(DEFAULT_LINE_USER_ID)=' .env | xargs -0 -I {} bash -lc 'printf %s "{}"') || true
  fi
  TO="${DEFAULT_LINE_USER_ID:-}"
fi

PAYLOAD=$(jq -nc --arg type "$TYPE" --arg to "$TO" '{type:$type, to: ($to // empty)}')
curl -sS -X POST http://localhost:3000/api/push \
  -H 'Content-Type: application/json' \
  --data-binary "$PAYLOAD"
echo


