#!/usr/bin/env bash
# Push Pages secrets from the untracked .env to the mtw4 Cloudflare Pages
# project.
#
# .env is the source of truth (back it up in a password manager);
# Cloudflare's encrypted variables are a write-only mirror.
#
# IMPORTANT: Pages secrets only bind on the NEXT deployment — after pushing,
# redeploy the site or the new values are not live.
#
# Run manually: bash scripts/push-secrets.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PROJECT_NAME="${PROJECT_NAME:-mtw4}"

if [ ! -f .env ]; then
  echo "Error: .env not found. Copy .env.example to .env and fill in real values." >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
source .env
set +a

SECRETS=(PARCHMENT_API_KEY TURNSTILE_SECRET_KEY)

for NAME in "${SECRETS[@]}"; do
  if [ -z "${!NAME:-}" ]; then
    echo "Error: ${NAME} is not set in .env" >&2
    exit 1
  fi
done

for NAME in "${SECRETS[@]}"; do
  echo "Pushing ${NAME} to Pages project '${PROJECT_NAME}'..."
  printf '%s' "${!NAME}" | npx wrangler pages secret put "${NAME}" \
    --project-name "${PROJECT_NAME}"
done

echo "✓ Pages secrets pushed."
echo "  Remember: secrets bind on the NEXT deployment — redeploy '${PROJECT_NAME}' now."
