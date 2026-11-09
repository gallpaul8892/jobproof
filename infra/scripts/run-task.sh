#!/usr/bin/env bash
# Run one of the one-off ECS tasks (db-roles, migrate, create-user, seed-demo), wait for it to
# stop, print its log, and exit with the container's exit code (INFRA spec 4.3 steps 4 to 6, 5.6).
#
#   infra/scripts/run-task.sh <task key>
#
# Environment (the variables export-outputs.sh sets, plus):
#   CLUSTER, OPS_NETWORK, OPS_TASK_FAMILIES, LOG_GROUPS   required
#   COMMAND_JSON      optional JSON array: replaces the task's default command
#   TIMEOUT_SECONDS   default 900; the task is stopped after that
#   AWS_BIN           default "aws" (tests substitute a stub)
#
# The task definition is resolved to an explicit revision ARN, which is what the deploy role's
# ecs:RunTask permission matches. The log is indented so no line can start with "::" and be taken
# as a workflow command. The tasks never log secrets (create-user logs only the new user's id).
set -euo pipefail

die() { printf 'run-task: %s\n' "$*" >&2; exit 1; }

KEY="${1:-}"
case "$KEY" in db-roles|migrate|create-user|seed-demo) ;; *) die "usage: run-task.sh db-roles|migrate|create-user|seed-demo" ;; esac
: "${CLUSTER:?CLUSTER is required}" "${OPS_NETWORK:?OPS_NETWORK is required}"
: "${OPS_TASK_FAMILIES:?OPS_TASK_FAMILIES is required}" "${LOG_GROUPS:?LOG_GROUPS is required}"
AWS_BIN="${AWS_BIN:-aws}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-900}"
COMMAND_JSON="${COMMAND_JSON:-}"

family="$(jq -er --arg k "$KEY" '.[$k]' <<<"$OPS_TASK_FAMILIES")" || die "this environment has no '$KEY' task (seed-demo exists in dev only)"
if [ "$KEY" = "migrate" ]; then group_key="migrate"; else group_key="ops"; fi
log_group="$(jq -er --arg k "$group_key" '.[$k]' <<<"$LOG_GROUPS")" || die "no log group '$group_key'"

td_arn="$("$AWS_BIN" ecs describe-task-definition --task-definition "$family" \
  --query 'taskDefinition.taskDefinitionArn' --output text)"
case "$td_arn" in arn:aws:ecs:*) ;; *) die "could not resolve the task definition for $family" ;; esac

network="$(jq -c '{awsvpcConfiguration: {subnets: .subnets, securityGroups: .security_groups,
  assignPublicIp: (if .assign_public_ip then "ENABLED" else "DISABLED" end)}}' <<<"$OPS_NETWORK")"

args=(ecs run-task --cluster "$CLUSTER" --task-definition "$td_arn" --launch-type FARGATE --count 1
  --network-configuration "$network" --started-by github-actions --output json)
if [ -n "$COMMAND_JSON" ]; then
  jq -e 'type == "array" and length > 0 and all(type == "string")' <<<"$COMMAND_JSON" >/dev/null \
    || die "COMMAND_JSON must be a JSON array of strings"
  overrides="$(jq -cn --argjson c "$COMMAND_JSON" --arg n "$KEY" '{containerOverrides: [{name: $n, command: $c}]}')"
  args+=(--overrides "$overrides")
fi

echo "run-task: starting $KEY ($td_arn)"
started="$("$AWS_BIN" "${args[@]}")"
task_arn="$(jq -r '.tasks[0].taskArn // empty' <<<"$started")"
if [ -z "$task_arn" ]; then
  echo "run-task: ECS did not start the task:" >&2
  jq -r '.failures[]? | "  \(.arn // "") \(.reason // "") \(.detail // "")"' <<<"$started" >&2
  exit 1
fi
task_id="${task_arn##*/}"
echo "run-task: task $task_id started; waiting for it to stop (up to ${TIMEOUT_SECONDS}s)"

deadline=$((SECONDS + TIMEOUT_SECONDS))
while :; do
  last="$("$AWS_BIN" ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" \
    --query 'tasks[0].lastStatus' --output text)"
  [ "$last" = "STOPPED" ] && break
  if [ "$SECONDS" -ge "$deadline" ]; then
    "$AWS_BIN" ecs stop-task --cluster "$CLUSTER" --task "$task_arn" --reason "timed out by the workflow" >/dev/null || true
    die "$KEY did not finish within ${TIMEOUT_SECONDS}s and was stopped"
  fi
  sleep 10
done

result="$("$AWS_BIN" ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" --output json)"
exit_code="$(jq -r '.tasks[0].containers[0].exitCode // "none"' <<<"$result")"
reason="$(jq -r '.tasks[0].stoppedReason // ""' <<<"$result")"
container_reason="$(jq -r '.tasks[0].containers[0].reason // ""' <<<"$result")"

echo "::group::log of $KEY ($task_id)"
if events="$("$AWS_BIN" logs get-log-events --log-group-name "$log_group" \
  --log-stream-name "$KEY/$KEY/$task_id" --start-from-head --output json 2>/dev/null)"; then
  jq -r '.events[]?.message' <<<"$events" | sed 's/^/  | /'
else
  echo "  (no log stream yet: the container may not have started)"
fi
echo "::endgroup::"

if [ "$exit_code" != "0" ]; then
  echo "run-task: $KEY FAILED. exit code: $exit_code. stopped reason: $reason $container_reason" >&2
  exit 1
fi
echo "run-task: $KEY finished with exit code 0"
