#!/usr/bin/env bash
# Publish a built web bundle to the web bucket (INFRA spec 5.5), used by the pipeline.
#
#   WEB_BUCKET=<bucket> SITE_URL=https://<distribution domain> infra/scripts/upload-web.sh
#
# Environment
#   WEB_BUCKET       required. Bucket name (no s3:// prefix).
#   SITE_URL         required. The public origin, e.g. https://d1234abcd.cloudfront.net (no path).
#                    The API is same-origin behind CloudFront, so it is also the API base URL.
#   WEB_DIST         built bundle, default web/dist (never modified).
#   DISTRIBUTION_ID  if set, invalidates /index.html and /config.js at the end.
#   AWS_BIN          the AWS CLI, default "aws" (tests substitute a recording stub).
#
# Upload order matters, so a visitor never sees a page that points at files that are not there:
#   1. assets/   content-hashed names, immutable, kept forever (no --delete): old tabs and a
#                rollback still find their files
#   2. other static files (favicon and so on), short cache
#   3. config.js generated now by web/nginx/40-jobproof-config.sh (its strict origin validation),
#                never cached
#   4. index.html last, never cached: it is the switch that makes the new version live
# The dist's own config.js (a local-development default) is never uploaded.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AWS_BIN="${AWS_BIN:-aws}"
WEB_DIST="${WEB_DIST:-$ROOT/web/dist}"
WEB_BUCKET="${WEB_BUCKET:-}"
SITE_URL="${SITE_URL:-}"
DISTRIBUTION_ID="${DISTRIBUTION_ID:-}"

die() { printf 'upload-web: %s\n' "$*" >&2; exit 1; }

[ -n "$WEB_BUCKET" ] || die "WEB_BUCKET is required"
[ -n "$SITE_URL" ] || die "SITE_URL is required"
case "$WEB_BUCKET" in
  *[!a-z0-9.-]*|-*|.*) die "WEB_BUCKET must be a bucket name (lower case letters, digits, dots, hyphens)" ;;
esac
case "$SITE_URL" in
  https://*) ;;
  *) die "SITE_URL must start with https://" ;;
esac
[ -f "$WEB_DIST/index.html" ] || die "$WEB_DIST/index.html not found (run npm run build first)"
[ -d "$WEB_DIST/assets" ] || die "$WEB_DIST/assets not found (run npm run build first)"

TMP="$(mktemp -d)"
# Explicit, non-empty path only.
cleanup() { if [ -n "${TMP:-}" ] && [ -d "$TMP" ]; then rm -rf -- "$TMP"; fi; }
trap cleanup EXIT
mkdir -p "$TMP/config"

# config.js from the existing script; it exits non-zero on a malformed origin.
API_BASE_URL="$SITE_URL" DIST_DIR="$TMP/config" HEADERS_FILE="$TMP/headers.conf" \
  sh "$ROOT/web/nginx/40-jobproof-config.sh" >/dev/null \
  || die "SITE_URL was rejected by 40-jobproof-config.sh"
[ -s "$TMP/config/config.js" ] || die "config.js was not generated"

DEST="s3://$WEB_BUCKET"
IMMUTABLE="public,max-age=31536000,immutable"

echo "upload-web: 1/4 assets"
"$AWS_BIN" s3 sync "$WEB_DIST/assets" "$DEST/assets" --only-show-errors --cache-control "$IMMUTABLE"

echo "upload-web: 2/4 other static files"
"$AWS_BIN" s3 sync "$WEB_DIST" "$DEST" --only-show-errors \
  --exclude "assets/*" --exclude "index.html" --exclude "config.js" \
  --cache-control "public,max-age=3600"

echo "upload-web: 3/4 config.js"
"$AWS_BIN" s3 cp "$TMP/config/config.js" "$DEST/config.js" --only-show-errors \
  --content-type "application/javascript" --cache-control "no-cache, no-store, must-revalidate"

echo "upload-web: 4/4 index.html"
"$AWS_BIN" s3 cp "$WEB_DIST/index.html" "$DEST/index.html" --only-show-errors \
  --content-type "text/html; charset=utf-8" --cache-control "no-cache, no-store, must-revalidate"

if [ -n "$DISTRIBUTION_ID" ]; then
  echo "upload-web: invalidating /index.html and /config.js"
  "$AWS_BIN" cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" \
    --paths "/index.html" "/config.js" >/dev/null
fi
echo "upload-web: done"
