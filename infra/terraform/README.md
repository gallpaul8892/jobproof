# infra/terraform

Terraform for the two JobProof environments (ticket INFRA-4; plan in
[specs/INFRA-aws-pipeline.md](../../specs/INFRA-aws-pipeline.md), section 3). **Nothing here has been
planned or applied yet**: the sandbox that wrote it has no AWS account and no access to the
Terraform registry (see "What was and was not verified").

```
infra/terraform/
  modules/
    account_baseline/  S3 account public-access block, IAM Access Analyzer, CloudTrail, GuardDuty switch
    network/           VPC, 2 AZs, public / app / db subnets, IGW, S3 endpoint, optional single NAT
    ecr/               jobproof-backend: immutable tags, scan on push, keep 30, cross-account pull (dev)
    rds/               PostgreSQL 16, gp3, encrypted, TLS forced, RDS-managed master secret, backups
    secrets/           generated app secrets via ephemeral random_password + write-only arguments
    alb/               INTERNAL ALB, target group (ip, 8000), health check /health/live, CloudFront-only SG
    ecs_service/       cluster, API service, one-off tasks db-roles / migrate / create-user / seed-demo
    web_static/        web + releases buckets, CloudFront (OAC, VPC origin, SPA function, header policies)
    photos_bucket/     private photos bucket, no access granted yet
    ci_roles/          jobproof-github-deploy (narrow OIDC role for the workflows)
    monitoring/        SNS email topic, alarms, cost anomaly detection
    waf/               CloudFront web ACL (prod; created in us-east-1)
  envs/
    dev/   main.tf variables.tf outputs.tf versions.tf  backend.tf  terraform.tfvars
    prod/  (the same four files, byte for byte)         backend.tf  terraform.tfvars  guard.tf
  check-env-parity.sh   fails if dev and prod differ anywhere except tfvars, backend and guard.tf
  .tflint.hcl           tflint config (bundled terraform ruleset)
```

`dns` (certificates, custom domain, ALB HTTPS) is INFRA-8 and does not exist yet.

## How the two environments differ

Only `terraform.tfvars` (plus the state key in `backend.tf`, and prod's `guard.tf`).

| Setting | dev | prod |
|---|---|---|
| `app_env` | `staging` | `production` |
| VPC / NAT | `10.20.0.0/16`, no NAT, tasks in public subnets (admit only the ALB) | `10.30.0.0/16`, one NAT, tasks in private subnets |
| Database | micro, single-AZ, 7-day backups, no protection | micro single-AZ at first (P3), 14-day backups, deletion protection, final snapshot |
| Tasks | 1 x 0.25 vCPU / 0.5 GB, logs 14 days | same at first, logs 90 days. Resilient size is a commented block at the bottom of the prod tfvars |
| Demo data | `demo_seed_allowed = true`: `demo-password` secret and the `seed-demo` task exist | **rejected**: see below |
| WAF / GuardDuty / alarms | off / off / off (cost anomaly stays on) | on / on / on |
| Secret recovery window | 0 days | 30 days |

**Prod rejects `DEMO_SEED_ALLOWED`.** Three independent layers: (1) `variables.tf` validation fails
the plan if `demo_seed_allowed` is true while `environment = "prod"` or `app_env = "production"`;
(2) the `ecs_service` module repeats that validation, and creates the seed task only when the flag is
set; (3) the backend itself refuses it when `APP_ENV=production`. `check-env-parity.sh` also fails if
the prod tfvars contain `demo_seed_allowed = true`. `DEMO_SEED_ALLOWED` and `DEMO_PASSWORD` appear
only on the `seed-demo` task definition, which exists only in dev.

## Task definitions (per the INFRA-3 notes)

| Task | `DB_USER` | `DB_PASSWORD` from | Extra |
|---|---|---|---|
| API service | `jobproof_app` | `db-app-password` | `PUBLIC_API_BASE_URL`, `CORS_ALLOWED_ORIGINS` = CloudFront origin, `DEMO_ACCOUNTS_ENABLED=false` |
| `db-roles` | `jobproof_master` | RDS-managed master secret (`:password::`) | `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD` |
| `migrate` | `jobproof_migrator` | `db-migrator-password` | `DEFAULT_COMPANY_NAME` (P8) |
| `seed-demo` (dev) | `jobproof_migrator` | `db-migrator-password` | `DEMO_SEED_ALLOWED=true`, `DEMO_PASSWORD`. Default command `--if-empty`; the workflow overrides it with `--reset` |
| `create-user` | `jobproof_app` | `db-app-password` | `ADMIN_INITIAL_PASSWORD` from `jobproof/<env>/admin-initial-password` (made by hand, spec 1F). Default command is `--help`; the workflow overrides it |

Every task also gets `APP_ENV`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SSLMODE=verify-full`,
`DB_SSLROOTCERT=/app/certs/rds-global-bundle.pem`, `LOG_LEVEL=INFO`, `JWT_SECRET` and
`PHOTO_URL_SECRET` (the backend settings need all of them in staging and production, even for
`db-roles`). `FIXED_NOW` and `SEED_ANCHOR_DATE` are never set.

## Secrets: nothing secret in git or in state

- Generated values (`jwt-secret`, `photo-url-secret`, `db-app-password`, `db-migrator-password`,
  dev's `demo-password`) are `ephemeral "random_password"` resources fed into
  `aws_secretsmanager_secret_version.secret_string_wo` (write-only). Terraform never stores them in
  plan or state. Terraform tracks only `secret_string_wo_version`: to **rotate**, raise that secret's
  number in `secret_versions`, apply, then (for a `db-*` password) re-run `db-roles` and redeploy.
- The RDS master password is created and rotated by RDS (`manage_master_user_password`), also never
  in state. Only the secret's ARN is in state.
- `admin-initial-password` is created by hand and deleted by the workflow. Terraform only grants the
  ops execution role read access to that name.
- Encryption uses AWS-managed keys (no custom KMS key).
- State still holds non-secret identifiers (ARNs, account IDs). The state bucket is private,
  encrypted and readable only by the terraform role.

## Remote state

Each environment stores its state in **its own account's** bootstrap bucket
`jobproof-tfstate-<account id>` (key `jobproof/<env>/terraform.tfstate`) with S3 native locking
(`use_lockfile`, no DynamoDB). A backend block cannot use variables, so supply the bucket at init:

```
cd infra/terraform/envs/dev
terraform init -backend-config="bucket=jobproof-tfstate-<dev account id>"
terraform plan  -var 'allowed_account_ids=["<dev account id>"]' -var image_tag=<sha>
```

`allowed_account_ids` makes the AWS provider refuse any other account. The workflows pass it.

## Running it (the workflows do this in INFRA-5)

1. Edit `terraform.tfvars`: put your own `alarm_email` (the placeholder is rejected on purpose).
   In dev set `promotion_peer_account_id` to the prod account ID, in prod to the dev account ID,
   once both accounts are bootstrapped (it lets prod pull the image from dev by digest).
2. **First run only**: `terraform apply -target=module.ecr`, then push the image to that
   repository. This is the single documented use of `-target`.
3. `terraform apply -var image_tag=<sha>`. It registers new task-definition revisions but does NOT
   move the service (`ignore_changes = [task_definition, desired_count]`). The pipeline then runs
   `db-roles`, `migrate`, (dev) `seed-demo`, and finally `ecs update-service`. Old revisions are kept
   (`skip_destroy`) so a rollback can point at them.
4. Without `image_tag`, the tag is read from SSM `/jobproof/<env>/release`, which the pipeline
   writes (Terraform never manages that parameter). If neither exists the tag is `unreleased`,
   which only lets a plan run.
5. Commit the `.terraform.lock.hcl` that the first `terraform init` creates in each env directory,
   and use `terraform init -lockfile=readonly` in CI. It could not be generated offline.

`terraform output` (see `envs/*/outputs.tf`) gives the workflows everything they need: site URL,
distribution ID, buckets, ECR URL, cluster, service, task families, the `ops_network` settings for
`aws ecs run-task`, log groups, deploy role ARN and the database identifier.

## Design notes and deviations from the spec text

- **Same origin through CloudFront.** The internal ALB is reached by a CloudFront VPC origin. SPA
  routing is a CloudFront Function on the S3 behaviour only, never custom error pages (they would
  turn the API's `problem+json` 403/404 into HTML). `/api/*` uses `Managed-CachingDisabled` and
  `Managed-AllViewerExceptHostHeader`; `/assets/*` uses `Managed-CachingOptimized`. `/health` and
  `/health/*` go to the backend (the spec says "/health"; `/health/live` needs the second pattern).
- **`prevent_destroy` cannot be set from a variable**, so modules cannot carry it for prod's database
  and photos bucket. `envs/prod/guard.tf` holds one `terraform_data` with `prevent_destroy = true`
  that references both, so any plan that destroys prod fails. AWS-level protection is on too (RDS
  deletion protection and final snapshot, ALB deletion protection, buckets with
  `force_destroy = false`).
- **Ops execution role also reads the app secrets** (spec lists master, migrator, demo,
  admin-initial) because every task loads the backend settings, which need `JWT_SECRET`,
  `PHOTO_URL_SECRET` and `DB_PASSWORD`.
- **"ECS running tasks below desired" alarm** is implemented as ALB `HealthyHostCount` below the
  desired count (ECS `RunningTaskCount` needs Container Insights, extra cost). Same intent: it fires
  when no healthy task serves traffic.
- **`ci_roles` also lets dev stop and start the database** (`rds:Stop/StartDBInstance` on the one
  instance, dev only) because `dev-power.yml` needs it; the spec's role row omits it.
- **ECR cross-account pull** trusts the peer account root but narrows it with an `aws:PrincipalArn`
  condition to the peer's `jobproof-github-deploy` role, so the role need not exist when dev is
  applied.
- Dev tasks run in public subnets with a public IP (no NAT). The task security group admits only the
  ALB, and the ALB is internal.
- The ALB security group's only inbound rule is the CloudFront origin-facing managed prefix list.
  The list has about 55 entries, each counted against the group's 60-rule default quota. If AWS
  adds entries, raise the quota or switch to the CloudFront VPC-origin service security group.

## What was and was not verified (2026-11-09)

Verified by web search against upstream release data and documentation:

| Item | Result |
|---|---|
| Terraform CLI | 1.17.1 pinned as `>= 1.17.1, < 2.0.0` (spec Versions table; write-only arguments need 1.11, ephemeral values 1.10) |
| AWS provider | 6.72.0 is the latest (released 2026-11-04, releases.sh); pinned `~> 6.72`. 6.57.0 was withdrawn upstream, so `~> 6.72` also stays clear of it |
| `random` provider | latest seen v3.9.1 (3.9.0 released 2026-05-12); pinned `~> 3.9`. The **ephemeral `random_password` resource was added in 3.7.0** (release notes) |
| Write-only secret | `aws_secretsmanager_secret_version.secret_string_wo` plus `secret_string_wo_version`, fed from `ephemeral.random_password.<name>.result`, shown working in a third-party walkthrough. **The provider's own docs page could not be opened** (blocked fetch), and I could not read the minimum provider version. `~> 6.72` is well after the feature appeared, so the documented fallback (a generated value in state) was NOT needed |

NOT verified, because the sandbox cannot reach `releases.hashicorp.com`, `registry.terraform.io`,
`proxy.golang.org` or GitHub release downloads (the egress proxy answers 403, or DNS fails), and pip,
npm and apt carry no Terraform, OpenTofu or tflint binary:

- `terraform fmt`, `terraform init -backend=false`, `terraform validate` and `tflint` were **not
  run**. Without the registry even a CLI could not download the providers `validate` needs.
- Formatting was applied with a small script that aligns `=` in consecutive attribute lines (the main
  thing `fmt` changes). **Expect `terraform fmt -check` to report a few differences on its first
  run**; run `terraform fmt -recursive infra/terraform` once and commit.
- Structural checks that were run (python-hcl2 plus a cross-reference script): every `.tf` and
  `.tfvars` file parses; every module call passes only arguments the module declares and every
  required one; every `module.x.y` output exists; every `var.`, `local.`, resource and data
  reference resolves; every tfvars key has a variable and every required variable has a value; dev
  and prod `main.tf`, `variables.tf`, `outputs.tf` and `versions.tf` are identical.
- Resource arguments were written from knowledge of provider 6.x, not checked against its schema.
  Most likely to need a fix on first `validate`: `aws_cloudfront_vpc_origin` and the distribution's
  `vpc_origin_config`, `aws_ce_anomaly_subscription.threshold_expression`, the WAF rate-based
  `scope_down_statement`, and `data.aws_ssm_parameters_by_path` returning empty lists (not an
  error) when `/jobproof/<env>/release` does not exist yet.
- `terraform plan` and `apply` never ran (no AWS). Whether a CloudFront VPC origin accepts an ALB
  security group that allows only the origin-facing prefix list (the spec's design) is unproven.
  If the origin cannot reach the ALB, allow the `CloudFront-VPCOrigins-Service-SG` group instead.
- **Blocker for the first deploy, not for Terraform:** `backend/certs/rds-global-bundle.pem` is still
  the INFRA-3 placeholder. The backend refuses to start in staging and production with it. Replace it
  with AWS's global bundle before the first image is built.

## Cost estimate (GBP per month, excluding VAT, plus or minus 20%)

Figures are the spec's (section 6): on-demand prices, eu-west-2, 730 hours, $1 = 0.77 pounds, light
traffic, 20 GB database. This Terraform adds nothing that changes them: Secrets Manager holds 4
generated secrets plus the RDS master secret (plus dev's demo password and the occasional
admin-initial), alarms are a few pence each, CloudFront VPC origins cost nothing extra, and
CloudTrail's first management-event trail is free.

| Item | dev (always on) | prod, smallest (P3 start) | prod, resilient |
|---|---|---|---|
| Fargate | 8 | 8 | 32 |
| Public IPv4 for tasks | 3 | n/a | n/a |
| NAT gateway (1) | none | 29 | 29 (+ data) |
| Internal ALB | 15 | 15 | 16 |
| RDS (instance, storage, backups) | 12 | 12 | 45 |
| Secrets Manager | 2 | 2 | 2 |
| CloudWatch logs, metrics, alarms | 1 | 2 | 3 |
| CloudFront, S3, ECR, SSM, CloudTrail | 1 | 1 | 2 |
| WAF (`enable_waf`) | none | 6 | 6 |
| GuardDuty (`enable_guardduty`) | none | 3 | 4 |
| **Total** | **about 42 to 45** | **about 70** | **about 135 to 140** |

Cutting dev: destroy it when unused (about 1 a month while off, pipeline rebuilds in 15 to 20
minutes); sleep it out of hours with `dev-power` (saves about 12). Details in spec section 6.

Pricing Calculator: <https://calculator.aws/> (a saved estimate cannot be created offline; enter the
lines above for eu-west-2 Europe (London)). Re-check against the first real bill: AWS's London
prices for Fargate, ALB and NAT could not be read when the spec was written.
