#!/usr/bin/env bash
# For the workflows that run without Terraform (rollback, create-user, dev-demo-data, dev-power):
# read the environment's non-secret configuration (cluster, service, subnets, buckets ...) that the
# last deploy stored in the releases bucket, and export it for the later steps.
#
#   ENVIRONMENT=dev|prod ACCOUNT_ID=<12 digits> infra/scripts/load-config.sh
#
# Runs with the deploy role, which may read the releases bucket. Exits with a clear message when
# no deploy has stored the file yet (run the pipeline, or deploy-prod, first).
set -euo pipefail

die() { printf 'load-config: %s\n' "$*" >&2; exit 1; }

: "${ENVIRONMENT:?}" "${ACCOUNT_ID:?}"
case "$ENVIRONMENT" in dev|prod) ;; *) die "ENVIRONMENT must be dev or prod" ;; esac
[[ "$ACCOUNT_ID" =~ ^[0-9]{12}$ ]] || die "ACCOUNT_ID must be 12 digits"
AWS_BIN="${AWS_BIN:-aws}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="${RUNNER_TEMP:-/tmp}/tf-outputs-$ENVIRONMENT.json"
bucket="jobproof-$ENVIRONMENT-releases-$ACCOUNT_ID"

"$AWS_BIN" s3 cp "s3://$bucket/config/outputs.json" "$dest" --only-show-errors \
  || die "could not read s3://$bucket/config/outputs.json (has $ENVIRONMENT been deployed yet?)"
"$HERE/export-outputs.sh" "$dest"
actual="$(jq -r '.releases_bucket // ""' "$dest")"
[ "$actual" = "$bucket" ] || die "the stored configuration names bucket '$actual', expected '$bucket'"
echo "load-config: loaded the $ENVIRONMENT configuration"
