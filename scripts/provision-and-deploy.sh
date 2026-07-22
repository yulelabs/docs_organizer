#!/usr/bin/env bash
# Provision Neon + Railway + Cloudflare for docs-organizer, then deploy.
# Requires CLIs: neonctl, railway, wrangler (npm i -g neonctl @railway/cli wrangler)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PAGES_PROJECT="${PAGES_PROJECT:-docs-organizer}"
NEON_PROJECT_NAME="${NEON_PROJECT_NAME:-docs-organizer}"
NEON_REGION="${NEON_REGION:-aws-eu-central-1}"
RAILWAY_PROJECT_NAME="${RAILWAY_PROJECT_NAME:-docs-organizer}"

need() {
  command -v "$1" >/dev/null || {
    echo "Missing CLI: $1" >&2
    exit 1
  }
}

need neonctl
need railway
need wrangler
need jq
need npm

echo "==> Auth checks"
neonctl projects list --output json >/dev/null
railway whoami >/dev/null
wrangler whoami >/dev/null

echo "==> Neon project"
PROJECTS_JSON="$(neonctl projects list --output json)"
PROJECT_ID="$(echo "$PROJECTS_JSON" | jq -r --arg n "$NEON_PROJECT_NAME" '.projects[]? | select(.name==$n) | .id' | head -1)"
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "null" ]; then
  PROJECT_ID="$(echo "$PROJECTS_JSON" | jq -r --arg n "$NEON_PROJECT_NAME" '.[]? | select(.name==$n) | .id' | head -1)"
fi

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "null" ]; then
  echo "Creating Neon project $NEON_PROJECT_NAME in $NEON_REGION"
  CREATE_JSON="$(neonctl projects create --name "$NEON_PROJECT_NAME" --region-id "$NEON_REGION" --output json)"
  PROJECT_ID="$(echo "$CREATE_JSON" | jq -r '.project.id // .id')"
fi
echo "Neon project: $PROJECT_ID"

DATABASE_URL="$(neonctl connection-string --project-id "$PROJECT_ID" --role-name neondb_owner --database-name neondb)"
echo "Database URL acquired"

echo "==> Railway project"
if ! railway status >/dev/null 2>&1; then
  # Create + link when not already linked
  railway init --name "$RAILWAY_PROJECT_NAME" || true
fi

echo "Setting Railway variables"
railway variables \
  --set "DATABASE_URL=${DATABASE_URL}" \
  --set "NODE_ENV=production" \
  --set "PORT=3000" \
  --set "STORAGE_DRIVER=local" \
  --set "OCR_LANG=por+eng" \
  --set "LOCAL_STORAGE_DIR=/app/data/uploads" \
  --set "OCR_TMP_DIR=/app/data/ocr-tmp" \
  --skip-deploys

echo "==> Deploy API to Railway"
railway up --ci --detach

API_URL="$(railway domain 2>/dev/null || true)"
if [ -z "${API_URL:-}" ]; then
  echo "Generating Railway domain..."
  railway domain || true
  API_URL="$(railway domain 2>/dev/null || true)"
fi
# railway domain may print hostname only
if [[ "${API_URL:-}" != http* ]] && [ -n "${API_URL:-}" ]; then
  API_URL="https://${API_URL}"
fi
echo "API URL: ${API_URL:-unknown}"

if [ -n "${API_URL:-}" ]; then
  railway variables --set "CORS_ORIGIN=*" --skip-deploys || true
fi

echo "==> Cloudflare Pages"
npx wrangler pages project create "$PAGES_PROJECT" --production-branch=main || true

echo "Building frontend with VITE_API_BASE=${API_URL:-}"
npm ci
npm run build -w @docs-organizer/shared
VITE_API_BASE="${API_URL:-}" npm run build -w @docs-organizer/web

DEPLOY_OUT="$(npx wrangler pages deploy apps/web/dist --project-name="$PAGES_PROJECT" --branch=main)"
echo "$DEPLOY_OUT"

PAGES_URL="$(echo "$DEPLOY_OUT" | rg -o 'https://[a-zA-Z0-9.-]+\.pages\.dev' | head -1 || true)"
echo
echo "==== Deploy complete ===="
echo "Neon project:   $PROJECT_ID"
echo "API:            ${API_URL:-check Railway dashboard}"
echo "Frontend:       ${PAGES_URL:-check Cloudflare Pages dashboard}"
echo

# Persist deploy metadata for CI / docs (no secrets)
mkdir -p deploy
cat > deploy/last-deploy.json <<EOF
{
  "neonProjectId": "$PROJECT_ID",
  "apiUrl": "${API_URL:-}",
  "pagesUrl": "${PAGES_URL:-}",
  "pagesProject": "$PAGES_PROJECT",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

if [ -n "${API_URL:-}" ] && [ -n "${PAGES_URL:-}" ]; then
  railway variables --set "CORS_ORIGIN=${PAGES_URL}" --skip-deploys || true
fi
