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
# The deploy role's OIDC subject (modules/ci_roles) must have the same format as the bootstrap
# template's deploy role (including repository_owner_id and repository_id), or no workflow can
# assume the role. Both are normalised to the same placeholders and compared.
here="$(pwd)"
tf_line="$(grep -F '${wf}@refs/heads/main' "$here/../modules/ci_roles/main.tf" | head -n 1 || true)"
cfn_line="$(grep -F '${Workflow}@refs/heads/main' "$here/../../bootstrap/bootstrap.cfn.yaml" | head -n 1 || true)"
norm() {
  sed -e 's/^[^"]*"//' -e 's/"[^"]*$//' \
    -e 's/\${local\.repo}/OWNER\/REPO/g' -e 's/\${GitHubOwner}\/\${GitHubRepo}/OWNER\/REPO/g' \
    -e 's/\${wf}/WORKFLOW/g' -e 's/\${Workflow}/WORKFLOW/g' \
    -e 's/\${var\.github_owner_id}/OWNER_ID/g' -e 's/\${GitHubOwnerId}/OWNER_ID/g' \
    -e 's/\${var\.github_repo_id}/REPO_ID/g' -e 's/\${GitHubRepoId}/REPO_ID/g'
}
if [ -z "$tf_line" ] || [ -z "$cfn_line" ]; then
  echo "check-env-parity: could not find the OIDC subject template in ci_roles or bootstrap.cfn.yaml" >&2
  status=1
elif [ "$(printf '%s' "$tf_line" | norm)" != "$(printf '%s' "$cfn_line" | norm)" ]; then
  echo "check-env-parity: the ci_roles OIDC subject differs from the bootstrap template" >&2
  echo "  ci_roles : $(printf '%s' "$tf_line" | norm)" >&2
  echo "  bootstrap: $(printf '%s' "$cfn_line" | norm)" >&2
  status=1
fi
[ "$status" -eq 0 ] && echo "check-env-parity: ok"
exit "$status"
