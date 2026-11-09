#!/usr/bin/env bash
# Point the ECS service at a task-definition revision, wait until it is stable, and prove it is
# really on that revision (INFRA spec 4.3 step 7).
#
#   CLUSTER=... SERVICE=... TASK_DEFINITION_ARN=... infra/scripts/deploy-service.sh
#
# `aws ecs wait services-stable` also succeeds after the deployment circuit breaker has rolled
# back to the old revision. So after the wait this script checks that the service runs the
# requested revision and that its primary deployment COMPLETED, and fails otherwise.
set -euo pipefail

die() { printf 'deploy-service: %s\n' "$*" >&2; exit 1; }

: "${CLUSTER:?}" "${SERVICE:?}" "${TASK_DEFINITION_ARN:?}"
AWS_BIN="${AWS_BIN:-aws}"
case "$TASK_DEFINITION_ARN" in arn:aws:ecs:*:task-definition/*:*) ;; *) die "TASK_DEFINITION_ARN is not a revision ARN" ;; esac

echo "deploy-service: moving $SERVICE to ${TASK_DEFINITION_ARN##*/}"
"$AWS_BIN" ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition "$TASK_DEFINITION_ARN" --query 'service.serviceName' --output text >/dev/null

echo "deploy-service: waiting for the service to become stable (up to 10 minutes)"
"$AWS_BIN" ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" \
  || die "the service did not become stable in time"

state="$("$AWS_BIN" ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --output json)"
current="$(jq -r '.services[0].taskDefinition' <<<"$state")"
rollout="$(jq -r '[.services[0].deployments[] | select(.status == "PRIMARY")][0].rolloutState // "UNKNOWN"' <<<"$state")"
running="$(jq -r '.services[0].runningCount' <<<"$state")"
if [ "$current" != "$TASK_DEFINITION_ARN" ] || [ "$rollout" != "COMPLETED" ]; then
  die "the service is on $current (rollout $rollout), not the new revision: the new tasks failed their health checks and ECS rolled back"
fi
echo "deploy-service: stable on ${current##*/}, rollout COMPLETED, $running task(s) running"
