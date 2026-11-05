#!/usr/bin/env bash
#
# Build the game and deploy it to S3 + invalidate CloudFront.
#
# Hosting model: private S3 bucket behind CloudFront (OAC).
# The game is served at a subdomain root; CloudFront's Origin Path points at
# the "archery-game" prefix, so Vite's base stays "/" and no path rewriting is
# needed in the app.
#
# Config can be overridden with environment variables, or by creating a
# gitignored scripts/deploy.config.local (see DEPLOY.md). At minimum you must
# provide CLOUDFRONT_DISTRIBUTION_ID.

set -euo pipefail

# ---- Config (env overrides win) --------------------------------------------
BUCKET="${DEPLOY_BUCKET:-kylewillett.com}"
PREFIX="${DEPLOY_PREFIX:-archery-blitz}"
REGION="${DEPLOY_REGION:-us-east-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load gitignored local overrides (e.g. CLOUDFRONT_DISTRIBUTION_ID) if present.
if [ -f "$SCRIPT_DIR/deploy.config.local" ]; then
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/deploy.config.local"
fi

# ---- Preconditions ---------------------------------------------------------
command -v aws >/dev/null 2>&1 || {
  echo "error: aws CLI not found. Install and configure it (aws configure)." >&2
  exit 1
}

: "${CLOUDFRONT_DISTRIBUTION_ID:?Set CLOUDFRONT_DISTRIBUTION_ID (env var or scripts/deploy.config.local)}"

DEST="s3://${BUCKET}/${PREFIX}"

cd "$ROOT_DIR"

# ---- Build -----------------------------------------------------------------
echo "==> Building (npm run build)..."
npm run build

# ---- Upload ----------------------------------------------------------------
# 1) dist/assets/: Vite's content-hashed bundles and imported images. Their
#    names change whenever their content does, so they can be cached forever.
#    --delete removes stale bundles from previous deploys.
echo "==> Syncing hashed assets to ${DEST}/assets/ (immutable, 1y cache)..."
aws s3 sync dist/assets/ "${DEST}/assets/" \
  --region "$REGION" \
  --delete \
  --exclude ".DS_Store" \
  --cache-control "public, max-age=31536000, immutable"

# 2) Everything else except index.html: files copied verbatim from public/
#    (e.g. models/kaykit_props.glb). Their names are NOT content-hashed, so
#    they must revalidate — otherwise a rebuilt model would stay stale for a
#    year. ETags keep revalidation cheap (304 when unchanged).
echo "==> Syncing public files to ${DEST}/ (no-cache, revalidate)..."
aws s3 sync dist/ "${DEST}/" \
  --region "$REGION" \
  --delete \
  --exclude "assets/*" \
  --exclude "index.html" \
  --exclude "*.DS_Store" \
  --cache-control "no-cache"

# 3) index.html: no caching, so a new deploy is picked up immediately.
echo "==> Uploading index.html (no-cache)..."
aws s3 cp dist/index.html "${DEST}/index.html" \
  --region "$REGION" \
  --cache-control "no-cache" \
  --content-type "text/html"

# ---- Invalidate CloudFront -------------------------------------------------
# Viewers hit the subdomain root, so the viewer-facing paths are "/*".
echo "==> Invalidating CloudFront (${CLOUDFRONT_DISTRIBUTION_ID})..."
aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.{Id:Id,Status:Status}' \
  --output table

echo "==> Done. New version will be live once the invalidation completes (usually <1 min)."
