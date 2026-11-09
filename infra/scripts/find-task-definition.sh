#!/usr/bin/env bash
# Print the ARN of the newest ACTIVE API task-definition revision whose image tag is <version>
# (a commit SHA). Used to move the service to a version (deploy) or back to it (rollback).
#
#   API_FAMILY=jobproof-dev-api VERSION=<sha> infra/scripts/find-task-definition.sh
#
# Terraform registers a revision per image_tag and never deregisters old ones (skip_destroy), so
# a version that was ever applied is still here as long as it is within the last 100 revisions.
set -euo pipefail

die() { printf 'find-task-definition: %s\n' "$*" >&2; exit 1; }

: "${API_FAMILY:?API_FAMILY is required}" "${VERSION:?VERSION is required}"
[[ "$VERSION" =~ ^[0-9a-f]{40}$ ]] || die "VERSION must be a 40 character commit SHA"
AWS_BIN="${AWS_BIN:-aws}"

arns="$("$AWS_BIN" ecs list-task-definitions --family-prefix "$API_FAMILY" --status ACTIVE \
  --sort DESC --max-items 100 --query 'taskDefinitionArns' --output json)"
count=0
while IFS= read -r arn; do
  # The prefix also matches sibling families (jobproof-dev-migrate ...): keep only this family.
  case "$arn" in */"$API_FAMILY":*) ;; *) continue ;; esac
  count=$((count + 1))
  image="$("$AWS_BIN" ecs describe-task-definition --task-definition "$arn" \
    --query 'taskDefinition.containerDefinitions[0].image' --output text)"
  case "$image" in
    *:"$VERSION") printf '%s\n' "$arn"; exit 0 ;;
  esac
done < <(jq -r '.[]' <<<"$arns")
die "no task-definition revision of $API_FAMILY uses image tag $VERSION (looked at $count revisions)"
