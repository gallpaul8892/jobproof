#!/usr/bin/env bash
# Turn a flat Terraform outputs file into environment variables for the later steps of a job
# (INFRA spec 4.3). Used by the deploy composite action and by the workflows that run without
# Terraform (rollback, create-user, dev-demo-data, dev-power).
#
#   infra/scripts/export-outputs.sh outputs.json
#
# The file is `terraform output -json | jq -c 'map_values(.value)'`, written by the Terraform job
# and copied to s3://<releases bucket>/config/outputs.json after each deploy. Nothing in it is a
# secret (names, ids, subnets). Every value is checked against a strict pattern before it is
# written, so a malformed file cannot inject anything into later steps.
# Appends NAME=value lines to $GITHUB_ENV, or prints them when GITHUB_ENV is not set.
set -euo pipefail

die() { printf 'export-outputs: %s\n' "$*" >&2; exit 1; }

FILE="${1:-}"
[ -n "$FILE" ] && [ -s "$FILE" ] || die "usage: export-outputs.sh <outputs.json> (file missing or empty)"
jq -e 'type == "object"' "$FILE" >/dev/null || die "$FILE is not a JSON object"

OUT="${GITHUB_ENV:-/dev/stdout}"

scalar() { # scalar ENV_NAME output_key required(1|0)
  local name="$1" key="$2" required="$3" value
  value="$(jq -r --arg k "$key" '.[$k] | select(type == "string") // empty' "$FILE")"
  if [ -z "$value" ]; then
    [ "$required" = "1" ] && die "output '$key' is missing"
    return 0
  fi
  [[ "$value" =~ ^[A-Za-z0-9:/._@=-]+$ ]] || die "output '$key' has unexpected characters"
  printf '%s=%s\n' "$name" "$value" >> "$OUT"
}

json() { # json ENV_NAME output_key jq_validation_filter
  local name="$1" key="$2" check="$3" value
  value="$(jq -c --arg k "$key" '.[$k] // empty' "$FILE")"
  [ -n "$value" ] || die "output '$key' is missing"
  jq -e "$check" <<<"$value" >/dev/null || die "output '$key' has an unexpected shape"
  case "$value" in *$'\n'*|*$'\r'*) die "output '$key' is not single-line" ;; esac
  printf '%s=%s\n' "$name" "$value" >> "$OUT"
}

scalar CLUSTER ecs_cluster 1
scalar SERVICE ecs_service 1
scalar API_FAMILY api_task_family 1
scalar SITE_URL site_url 1
scalar WEB_BUCKET web_bucket 1
scalar RELEASES_BUCKET releases_bucket 1
scalar DISTRIBUTION_ID distribution_id 1
scalar ECR_REPOSITORY_URL ecr_repository_url 1
scalar ECR_REPOSITORY_NAME ecr_repository_name 1
scalar RELEASE_PARAMETER release_parameter 1
scalar DB_INSTANCE_ID db_instance_identifier 0

json OPS_NETWORK ops_network \
  '(.subnets | type == "array" and length > 0 and all(type == "string" and test("^[A-Za-z0-9-]+$")))
   and (.security_groups | type == "array" and length > 0 and all(type == "string" and test("^[A-Za-z0-9-]+$")))
   and ((.assign_public_ip | type) == "boolean")'
json OPS_TASK_FAMILIES ops_task_families \
  'type == "object" and (to_entries | all(.key | test("^[a-z-]+$"))) and (to_entries | all(.value | type == "string" and test("^[A-Za-z0-9_-]+$")))'
json LOG_GROUPS log_groups \
  'type == "object" and (to_entries | all(.key | test("^[a-z-]+$"))) and (to_entries | all(.value | type == "string" and test("^[A-Za-z0-9_./#-]+$")))'
