# infra/bootstrap

`bootstrap.cfn.yaml` is the one file uploaded by hand to each AWS account (dev, then prod).
Everything else is Terraform. Click-by-click steps are in [../README.md](../README.md), section
"Runbook: one-off setup". Plan: [specs/INFRA-aws-pipeline.md](../../specs/INFRA-aws-pipeline.md).

## What it creates (per account)

| Resource | Name | Notes |
|---|---|---|
| OIDC provider | `token.actions.githubusercontent.com` | Lets GitHub Actions sign in without keys. Audience `sts.amazonaws.com` |
| State bucket | `jobproof-tfstate-<account-id>` | Versioned, SSE-S3 encrypted, public access blocked, TLS only, kept if the stack is deleted |
| Plan role | `jobproof-github-plan` | `ReadOnlyAccess` plus explicit denies on object reads (except the state bucket), secret values, SSM parameter values (except `/jobproof/*/release`), `kms:Decrypt`, log contents |
| Terraform role | `jobproof-github-terraform` | `AdministratorAccess`; only the named workflow on `main` can assume it |

No access keys, no passwords, no secrets. Region is locked to eu-west-2 by a template rule.

## Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `Environment` | none | `dev` or `prod` |
| `GitHubOwner` | `gallpaul8892` | GitHub user or organisation |
| `GitHubRepo` | `jobproof` | Repository name |
| `GitHubOwnerId` | (none, required) | Numeric ID of the owner: `gh api users/OWNER --jq .id` |
| `GitHubRepoId` | (none, required) | Numeric ID of the repository: `gh api repos/OWNER/REPO --jq .id` |
| `SubjectMode` | `workflow` | `workflow` or `branch` (see below) |

## Who can assume what (the trust)

`SubjectMode=workflow` (decision P2 = yes). The repository's OIDC subject template is
`repo, context, job_workflow_ref, repository_owner_id, repository_id`, so the token subject looks like
`repo:OWNER/REPO:ref:refs/heads/main:job_workflow_ref:OWNER/REPO/.github/workflows/pipeline.yml@refs/heads/main:repository_owner_id:111:repository_id:222`.
The numeric IDs mean a renamed, deleted and recreated, or transferred repository cannot reuse the trust.

| Role | Allowed subjects |
|---|---|
| plan (dev and prod) | `ci.yml` on a pull request (`...:pull_request:job_workflow_ref:.../ci.yml@refs/pull/*`); `pipeline.yml` on `main` (prod-preview) |
| terraform, dev | `pipeline.yml` on `main` only |
| terraform, prod | `deploy-prod.yml` on `main` only |

`SubjectMode=branch` (fallback, P2 = no). The subject is GitHub's default, so only the branch can
be named: plan role = `repo:OWNER/REPO:pull_request` and `repo:OWNER/REPO:ref:refs/heads/main`;
terraform role = `repo:OWNER/REPO:ref:refs/heads/main` (any workflow on `main`). Protection then
rests on reviewing `.github/workflows/`. The two ID parameters are still required but unused in
this mode (the default subject carries no IDs).

**The repository's subject template and `SubjectMode` must agree**, and the template must be set
before the first pipeline run. Changing one later means updating both stacks (spec, risk 3).
The command is in the runbook, step "Tie the roles to workflow files".

## Verified facts (GitHub docs, checked 2026-11-09)

Source: GitHub's "OpenID Connect reference" (`github/docs`, `content/actions/reference/security/oidc.md`).

- `job_workflow_ref` is a supported claim for `include_claim_keys`; the docs show
  `{"include_claim_keys": ["repo", "context", "job_workflow_ref"]}` producing
  `repo:ORG/REPO:environment:ENV:job_workflow_ref:WORKFLOW-PATH`, and
  `["job_workflow_ref"]` producing `job_workflow_ref:octo-org/octo-automation/.github/workflows/oidc.yml@refs/heads/main`.
- Set per repository with `PUT /repos/{owner}/{repo}/actions/oidc/customization/sub`;
  `{"use_default": true}` resets it. The custom template replaces the whole default `sub`.
- Default subjects: `repo:O/R:pull_request`, `repo:O/R:ref:refs/heads/BRANCH`,
  `repo:O/R:environment:NAME`.
- The docs say to create the matching condition in the cloud provider before customising,
  otherwise tokens may be rejected.

### Not verified (assumptions to check at INFRA-6, first real run)

- Exactly what the `context` claim renders as for a branch push (assumed `ref:refs/heads/main`)
  and for a pull request (assumed `pull_request`). Confirm with the first run, or with
  `gh-oidc-sub`/a debug step that prints the token's `sub` (the subject is not secret).
- That `job_workflow_ref` for a plain (non-reusable) workflow is that workflow's own file. The
  docs describe it as "the ref path to the reusable workflow", but their example uses an ordinary
  workflow path. If a workflow's file is not what it reports, switch to `SubjectMode=branch`
  (update the stack: CloudFormation, Update stack, change the parameter).
- Newer repositories (docs mention an "immutable" default subject for repositories created after
  15 July 2026, `repo:OWNER@ID/REPO@ID:...`). A custom template overrides it, so `workflow`
  mode is unaffected, but `branch` mode would need the template adjusted for such a repository.
- The `PUT` call on a personal-account private repository (the docs describe it generally).
- If the pull request role subject differs (for example a `ci.yml` run through `workflow_call`),
  widen the plan role's pull-request line; the plan role is read-only.

## Notes

- If the account already has a GitHub OIDC provider, stack creation fails on
  `GitHubOidcProvider` ("already exists"). Fresh accounts never do. Fix: delete the old provider
  (IAM, Identity providers) if nothing uses it, then retry.
- Turn on **Termination protection** when creating the stack (runbook does). The state bucket is
  retained even if the stack is deleted.
- Lint: `pip install cfn-lint` then `cfn-lint infra/bootstrap/bootstrap.cfn.yaml` (clean on 1.60.0).
