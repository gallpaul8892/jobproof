#!/usr/bin/env bash
# envs/dev and envs/prod must differ only in terraform.tfvars, backend.tf and prod's guard.tf
# (spec section 3: same modules, different tfvars). Run by the `infra` CI job.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/envs"
status=0
for f in main.tf variables.tf outputs.tf versions.tf; do
  if ! diff -u "dev/$f" "prod/$f"; then
    echo "check-env-parity: $f differs between dev and prod" >&2
    status=1
  fi
done
# The prod tfvars must never mention the demo seed (validation rejects it as well).
if grep -Eq '^[[:space:]]*demo_seed_allowed[[:space:]]*=[[:space:]]*true' prod/terraform.tfvars; then
  echo "check-env-parity: prod/terraform.tfvars sets demo_seed_allowed = true" >&2
  status=1
fi
[ "$status" -eq 0 ] && echo "check-env-parity: ok"
exit "$status"
