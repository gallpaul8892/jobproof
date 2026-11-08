# INFRA: AWS environments and delivery pipeline (plan for approval)

Status: **draft for Paul's approval. Nothing here is built.** No Terraform, workflow or AWS
resource exists yet. Owner: architect. Date: 2026-11-08.

## Summary (plain English)

When this is built, you will not need your laptop to ship JobProof:

1. Claude (or you) pushes a change to `main` on GitHub (`gallpaul8892/jobproof`).
2. GitHub Actions runs every check we run today (lint, unit and API tests against a real
   Postgres, browser tests), then builds the backend container and the web app **once**.
3. If everything passes, it deploys automatically to **dev**, an AWS account of its own. Dev
   has a web address (something like `https://d1abc234.cloudfront.net`) that works in any
   browser, filled with demo data.
4. **Prod** (a second, separate AWS account) changes only when you press **"Run workflow"** on
   the "Deploy to prod" workflow in GitHub. That deploys exactly the version already running on
   dev, so what reaches prod has been tried first.

What you do by hand is short and done once: create the AWS accounts, turn on single sign-in,
upload one prepared file per account, and add two values in GitHub (section 1). After that,
everything is code in this repository.

Costs (section 6, estimates that exclude VAT): dev about **£45 a month** if it runs around the
clock, or less if it sleeps at night. Prod about **£70 a month** at its smallest, or about
**£135 a month** once it is set up to survive failures for real customers.

**Never paste passwords, secret values or access keys into a chat with Claude, into GitHub or
into a ticket.** Account IDs, role names, bucket names and web addresses are fine to share. You
should never need to create an AWS access key. If any guide asks you to, stop and ask.

## 0. Decisions for Paul

Each decision has a recommended default. If you say "go with the defaults", the plan below is
what gets built.

| # | Question | Recommended default | Why / trade-off |
|---|---|---|---|
| P1 | Should the GitHub repository be private or public? | **Private**, on the free GitHub plan | It is your commercial product. The catch: on free, Pro and Team plans, GitHub's "required reviewers" Approve button works **only on public repositories** (verified, GitHub docs). So prod approval is a deliberate "Run workflow" click on a dedicated workflow, not an Approve button. Either way, you make one deliberate click. If you make the repo public you get the Approve button, and we would use it |
| P2 | Allow Claude, with your permission at the prompt, to run one GitHub command that ties AWS roles to specific workflow files ("OIDC subject customisation")? | **Yes** | Without it, any workflow on `main` could use the prod role. With it, only `deploy-prod.yml` can. GitHub has no button for this, only an API call |
| P3 | Build prod now or later? | **Prove prod now at the smallest size (about £70 a month), then switch on the resilient size (about £135) before real customer data arrives** | Prod has no real use until operatives can submit reports (Phase 2), so paying for resilience now is waste. Proving the path early is cheap insurance. Option: run prod only for the proof, then destroy it (about £0 until needed) |
| P4 | Should dev sleep outside working hours? | **No, always on (about £45)**. Add a "Wake dev" / "Sleep dev" button so you can switch later | You asked for dev to be reachable from any browser. The schedule saves about £12 a month |
| P5 | PostgreSQL version on AWS | **16** (as local and CI), upgrade to 18 in 2027 | RDS 16 has standard support until 28 Feb 2029, RDS 18 until 28 Feb 2031 (verified). Changing now means changing local, CI and the workspace together. Recorded as a dated deferral |
| P6 | Rate-limit sign-in attempts in prod (AWS WAF, about £6 a month)? | **Yes in prod, no in dev** | Sign-in hashing is deliberately slow, so a flood of sign-ins could overload a small prod. Dev holds only demo data |
| P7 | Threat detection (GuardDuty, about £3 to £5 a month per account) | **Prod only** | Prod will hold customer data and photos |
| P8 | Company name used for the first prod database | **"Arbour Services"** unless you name one | The Admin can rename it in the app at any time |
| P9 | Add a command to create Manager accounts (today only Admins can be created, `create-admin`) | **Yes, as part of INFRA-3** | Without it, nobody could use prod as a manager. It is a small change |
| P10 | Branch protection on `main` | **Allow direct pushes (your current flow). The pipeline still refuses to deploy anything that fails** | Requiring pull requests is safer but slows the agent workflow. Revisit when more people join |
| P11 | Custom domain | **Later.** Everything works on AWS-provided addresses first. Buy the domain before the mobile app is released or customers get links | A Play Store app and payment links need an address that never changes. A CloudFront address changes if the distribution is ever rebuilt |

Open questions (they do not block the design): which email addresses to use for the three AWS
accounts (a `+` alias such as `paul+jobproof-dev@...` works with most providers), and whether
you already have an AWS account (we recommend a fresh one as the management account).

## 1. What you do by hand (once)

About 60 to 90 minutes in total. Console labels move from time to time. If a button is named
slightly differently, look for the nearest match, and do not create anything not listed here.

### 1A. Create the management account (about 15 minutes)

1. Go to `aws.amazon.com` and click **Create an AWS account**.
2. Root email: an address used only for this account (e.g. `paul+jobproof-root@...`). Account
   name: `JobProof Management`. Verify the email.
3. Set a long, unique root password and store it in a password manager.
4. Contact details: your UK address. Payment card. Phone verification. Support plan: **Basic
   (free)**.
5. Sign in as root. Click your account name (top right), then **Security credentials**, then
   **Assign MFA device**. Choose a passkey or an authenticator app and finish the steps.
6. Region selector (top right): choose **Europe (London) eu-west-2**. Use London everywhere.
7. Search **Billing and Cost Management**, open **Budgets**, then **Create budget**. Choose
   **Use a template**, then **Monthly cost budget**. Amount: 250 (USD), and enter your email.
   Click **Create budget**. This budget covers all three accounts.
8. Account name (top right), then **Account**. Scroll to **IAM user and role access to Billing
   information**, click **Edit**, tick **Activate**, then **Update**. This lets your sign-in
   from step 1C see bills.

### 1B. Create the organisation and the two accounts (about 10 minutes)

1. Search **AWS Organizations** and click **Create an organization**. Confirm the email AWS
   sends you.
2. Click **Add an AWS account**, then **Create an AWS account**. Name: `jobproof-dev`. Email:
   e.g. `paul+jobproof-dev@...`. Leave the role name as `OrganizationAccountAccessRole`. Click
   **Create AWS account**.
3. Repeat for `jobproof-prod`.
4. Wait until both show **Active**. Note each 12-digit **Account ID**. These are not secrets.
5. Search **IAM**, open **Root access management** (left menu) and click **Enable**. Tick
   **Root credentials management**. This removes the root passwords of the two new accounts, so
   nobody can sign in to them as root.

### 1C. Your everyday sign-in: IAM Identity Center (about 15 minutes)

1. Check that the region is London. Search **IAM Identity Center**, click **Enable**, and choose
   the organisation option.
2. **Users**, then **Add user**: username `paul`, your email and name. Click **Next**, then
   **Add user**. Accept the invitation email, set a password, and register MFA when asked.
3. **Permission sets**, then **Create permission set**: **Predefined**, `AdministratorAccess`,
   then **Next** and **Create**. Repeat with `ReadOnlyAccess` for day-to-day looking.
4. **AWS accounts**: tick all three accounts, click **Assign users or groups**, choose `paul`,
   tick both permission sets, then **Submit**.
5. **Settings**: copy the **AWS access portal URL** and bookmark it. From now on, always sign
   in there, not as root.
6. **Settings**, **Authentication**, **Multi-factor authentication**, **Configure**: choose
   **Every time they sign in**.

### 1D. Upload the bootstrap file into dev, then prod (about 10 minutes each)

Claude writes `infra/bootstrap/bootstrap.cfn.yaml` (ticket INFRA-1). It creates exactly three
things: the GitHub sign-in link (an OIDC provider), the bucket that stores Terraform's record of
what exists (the state bucket), and the roles GitHub may use. It creates no keys and no
passwords.

1. On GitHub, open `infra/bootstrap/bootstrap.cfn.yaml` and click **Download raw file**.
2. Open the access portal, choose **jobproof-dev**, then **AdministratorAccess**. Check that the
   region is London.
3. Search **CloudFormation**, then **Create stack**, **With new resources (standard)**. Choose
   **Upload a template file**, pick the downloaded file, then **Next**.
4. Stack name: `jobproof-bootstrap`. Parameters: `Environment` = `dev` (the others are
   pre-filled with `gallpaul8892` and `jobproof`). **Next**, **Next**.
5. Tick **I acknowledge that AWS CloudFormation might create IAM resources with custom names**,
   then **Submit**. Wait for **CREATE_COMPLETE** (about 2 minutes).
6. Repeat steps 2 to 5 in **jobproof-prod** with `Environment` = `prod`.

### 1E. GitHub settings (about 5 minutes)

1. Repository **Settings**, **Secrets and variables**, **Actions**, **Variables** tab, then
   **New repository variable**: `AWS_DEV_ACCOUNT_ID` = the dev account ID. Repeat for
   `AWS_PROD_ACCOUNT_ID`. These are the only two values. Everything else is derived by naming
   convention, and nothing secret is stored in GitHub.
2. If you chose P2 = yes: when Claude asks for permission to run the GitHub OIDC command, allow
   it. Do this **before** the first deploy.

### 1F. Later, once per environment: the first Admin (about 5 minutes)

1. Access portal, then the prod account. Search **Secrets Manager**, **Store a new secret**,
   **Other type of secret**, **Plaintext**. Type a password of 12 or more characters from your
   password manager. Name it `jobproof/prod/admin-initial-password`. Turn rotation off, then
   **Store**.
2. GitHub **Actions** tab, **Create admin** workflow, **Run workflow**: environment `prod`,
   email, full name. The workflow creates the account, then deletes that secret.
3. Sign in to prod with that email and password.

To see dev's demo password: dev account, **Secrets Manager**, `jobproof/dev/demo-password`,
**Retrieve secret value**. Read it there. Do not copy it anywhere else.

## 2. How it fits together

```
 Browser ── HTTPS ──> CloudFront  (https://dXXXX.cloudfront.net, later your domain)
                        │  /, /assets/*, /config.js ──> S3 web bucket (private, OAC)
                        │  /api/*, /health          ──> VPC origin ──> internal ALB
                        v                                                   │ HTTP :80 inside the VPC
                                                      ECS Fargate backend task(s) :8000
                                                          │                  │
                                              RDS Postgres 16 (private)   S3 photos bucket (private)
                                              Secrets Manager, ECR, CloudWatch Logs
```

**One web address for both the app and the API (same origin).** This is the key design choice.
It changes the Phase 1 decision "CORS allowlist, no same-origin proxy".

- An ALB without your own domain has no HTTPS certificate, and an HTTPS page cannot call an
  HTTP API (browsers block mixed content). CloudFront's own address *does* have HTTPS. So we
  route `/api/*` and `/health` through the same CloudFront distribution to the backend.
- CloudFront reaches the ALB through a **VPC origin**, so the ALB is **internal**: it has no
  public address and cannot be reached from the internet at all. Verified: VPC origins support
  ALBs in private subnets, eu-west-2 has no zone exceptions, the VPC must still have an internet
  gateway (only as a marker), and the ALB's security group allows the CloudFront origin-facing
  prefix list. Traffic from CloudFront to the ALB stays on AWS's private network. Once a domain
  exists we can add HTTPS on the ALB as well (INFRA-8).
- `config.js` is still generated per environment: `apiBaseUrl` = the CloudFront origin. The
  CSP can stay strict (`connect-src 'self'`). CORS stays configured with that same origin, which
  is harmless for same-origin calls and keeps the config guard happy.
- Local development is unchanged: web on 8080, API on 8000, cross-origin.
- Not chosen: CloudFront's flat-rate plans, because VPC origins are available only from the
  Business tier upward (verified). We use pay-as-you-go CloudFront, where VPC origins cost
  nothing extra.

**CloudFront gotchas the module must handle:**
- SPA routing must **not** use distribution-wide custom error pages (403/404 rewritten to
  `/index.html`). Those would also turn the API's `problem+json` 403 and 404 responses into
  HTML. Instead, a small **CloudFront Function** on the default (S3) behaviour rewrites paths
  without a file extension to `/index.html`. `/api/*` is never rewritten.
- The `/api/*` behaviour uses the managed `CachingDisabled` cache policy and the
  `AllViewerExceptHostHeader` origin request policy. With caching off, that forwards the
  `Authorization` header (verified, AWS knowledge centre). All HTTP methods are allowed. The
  API's own `Cache-Control` passes through unchanged (ARCHITECTURE section 9.2 requirement).
- `/assets/*` uses `CachingOptimized` (the files are content-hashed). `index.html` and
  `config.js` are uploaded with `Cache-Control: no-cache`. The pipeline also invalidates those
  two paths after each deploy.
- On the default `*.cloudfront.net` certificate, CloudFront's minimum TLS version cannot be
  raised. With a custom domain we set `TLSv1.2_2021` (INFRA-8).

## 3. Terraform layout and what each module creates

Terraform in `/infra/terraform`. **The same modules serve both environments.** Only the small
`envs/<env>/terraform.tfvars` files differ. Each environment's state is stored in its own
account's state bucket, with S3 native locking.

```
infra/
  bootstrap/bootstrap.cfn.yaml       # the one file Paul uploads (section 1D)
  terraform/
    modules/
      account_baseline/  network/  ecr/  rds/  secrets/  alb/  ecs_service/
      web_static/  photos_bucket/  ci_roles/  monitoring/  waf/ (prod)  dns/ (later)
    envs/
      dev/   main.tf  backend.tf  terraform.tfvars   # APP_ENV=staging
      prod/  main.tf  backend.tf  terraform.tfvars   # APP_ENV=production
  scripts/   deploy helpers called by the workflows (run-task-and-wait, upload-web, smoke)
```

Naming: the environment is called **dev**. Its `APP_ENV` is **staging**, because the backend
accepts only `local`, `test`, `staging` and `production`.

| Module | Creates | dev | prod |
|---|---|---|---|
| bootstrap (CloudFormation, not Terraform) | GitHub OIDC provider; state bucket `jobproof-tfstate-<account-id>` (versioned, encrypted, public access blocked, TLS only); roles `jobproof-github-plan` and `jobproof-github-terraform` | yes | yes |
| `account_baseline` | Account-wide S3 public-access block, IAM Access Analyzer, a CloudTrail trail (management events, to a private bucket), GuardDuty (P7) | no GuardDuty | GuardDuty |
| `network` | VPC over 2 availability zones: public subnets, private app subnets, private DB subnets; internet gateway; S3 gateway endpoint (free) | `10.20.0.0/16`; **no NAT**: tasks run in the public subnets with a public IP, and their security group lets in only traffic from the ALB | `10.30.0.0/16`; tasks in private subnets; **one NAT gateway** |
| `ecr` | Repository `jobproof-backend`: immutable tags, scan on push, keeps the last 30 images. Prod's repository policy lets nothing else in; dev's lets the prod deploy role pull (for promotion) | yes | yes |
| `rds` | Postgres 16 (latest 16.x minor, auto minor upgrades in a Sunday 03:00 UK window), gp3 20 GB, encrypted, not publicly accessible, DB subnet group, security group allowing 5432 only from the app and ops task security groups, parameter group with `rds.force_ssl=1`; master password managed by RDS in Secrets Manager (`manage_master_user_password`); automated backups and point-in-time restore | `db.t4g.micro`, single-AZ, 7-day backups, no deletion protection | `db.t4g.micro` single-AZ at first (P3), then `db.t4g.small` Multi-AZ, 14-day backups, deletion protection, final snapshot, `prevent_destroy` |
| `secrets` | Secrets Manager: `jwt-secret`, `photo-url-secret`, `db-app-password`, `db-migrator-password`, and `demo-password` (dev only). Values come from ephemeral random passwords written through **write-only arguments**, so they are **never stored in Terraform state** (exact provider support verified in INFRA-4). AWS-managed encryption keys (no £1-a-month custom key) | yes | yes, no demo secret |
| `alb` | **Internal** ALB in the private app subnets, HTTP listener on 80, target group (type `ip`, port 8000, health check `GET /health/live`, deregistration delay 20 s); security group allowing only the CloudFront origin-facing prefix list | yes | yes |
| `ecs_service` | Cluster; app task definition (environment variables, secrets per container, `awslogs` to a log group); **one-off task definitions** `db-roles`, `migrate`, `create-user`, and `seed-demo` (dev only), all from the same image; two execution roles (app: reads app secrets only; ops: reads master, migrator and admin secrets); task roles with no permissions yet; service with rolling deploy (min 100%, max 200%), deployment circuit breaker with automatic rollback, stop timeout 30 s; ECS Exec off by default (break-glass switch) | 1 task, 0.25 vCPU / 0.5 GB, logs kept 14 days | 1 task (0.25 / 0.5) at first, then 2 to 4 tasks of 0.5 vCPU / 1 GB with CPU autoscaling, logs kept 90 days |
| `web_static` | Private S3 web bucket (OAC only); a private releases bucket (`web/<sha>.tar.gz`, kept 180 days) for rollback; CloudFront distribution (PriceClass_100, HTTP/2 and HTTP/3), S3 origin with OAC, VPC origin for the ALB, behaviours as in section 2, SPA CloudFront Function, two response-headers policies (web: CSP and others; api: nosniff, HSTS, referrer) | yes | yes, plus WAF (P6) |
| `photos_bucket` | Private photos bucket: public access blocked, SSE-S3, versioning, TLS only, noncurrent versions expire after 30 days. **No access is granted to anyone yet.** The task role gets `GetObject`/`PutObject` when `S3PhotoStore` is specified (later phase) | yes | yes, `prevent_destroy` |
| `ci_roles` | Narrow deploy role `jobproof-github-deploy`: push to/pull from `jobproof-backend`, `ecs:RunTask` on the jobproof task families, `ecs:UpdateService`/`Describe*` on the jobproof service, `iam:PassRole` on the jobproof task and execution roles only, put/delete on the web and releases buckets, `cloudfront:CreateInvalidation` on the one distribution, `ssm:PutParameter` on `/jobproof/<env>/release`, read the migrate and ops log groups | yes | yes |
| `monitoring` | SNS email topic (to you) and alarms: ALB target 5xx, unhealthy targets, ECS running tasks below desired, RDS CPU, free storage and connections, billing anomaly (Cost Anomaly Detection, free) | alarms off except cost | on |
| `waf` (prod) | WAF web ACL on CloudFront: a rate-based rule on `POST /api/v1/auth/login` (for example 100 per 5 minutes per IP) and the AWS managed common rule set in **count** mode first | no | yes (P6) |
| `dns` (later, INFRA-8) | ACM certificate in **us-east-1** (CloudFront requires that region), CloudFront alternate domain, ACM certificate in eu-west-2 and an HTTPS listener on the ALB, Route 53 records (or instructions for your registrar) | later | later |

**Image and release handling.** Terraform owns all infrastructure and all task-definition
settings. The image tag is a Terraform input (`image_tag` = git commit SHA). Its default is read
from the SSM parameter `/jobproof/<env>/release`, so pull-request plans show no change to the
image. A `terraform apply` registers new task-definition revisions but does **not** move the
service (`ignore_changes = [task_definition]` on the service). The pipeline moves the service
after migrations have succeeded (section 4), and a rollback moves it back to an older revision
without Terraform fighting it.

**First run.** The ECR repository must exist before the first image push. The pipeline runs
`terraform apply -target=module.ecr` once, only when the repository does not exist yet. This is
the single documented use of `-target`.

**Environment variables per task** (the app task; ops tasks get the subset they need):
`APP_ENV` (staging or production), `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_SSLMODE`
(`verify-full`), `DB_SSLROOTCERT`, `PUBLIC_API_BASE_URL` and `CORS_ALLOWED_ORIGINS` (both the
CloudFront origin), `LOG_LEVEL=INFO`, `DEMO_ACCOUNTS_ENABLED=false`. From Secrets Manager:
`DB_PASSWORD`, `JWT_SECRET`, `PHOTO_URL_SECRET`. The migrate task also gets
`DEFAULT_COMPANY_NAME` (P8). `FIXED_NOW` and `SEED_ANCHOR_DATE` are never set in AWS.

## 4. Pipeline (GitHub Actions)

### 4.1 Workflows

| File | Trigger | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | pull request; also called by `pipeline.yml` (`workflow_call`) | Checks only, no deploy (4.2). On pull requests, it also runs `terraform plan` for dev and prod with the read-only plan roles and posts the summary |
| `.github/workflows/pipeline.yml` | push to `main` | `ci` → `build` → `deploy-dev` → `prod-preview` (4.3). Concurrency group `deploy-dev`, never cancels a running deploy |
| `.github/workflows/deploy-prod.yml` | **manual** (`workflow_dispatch`), input `version` (commit SHA, shown in the pipeline summary as "running on dev") | Promotes that exact version to prod (4.4). This is the approval step |
| `.github/workflows/rollback.yml` | manual: `environment` (dev or prod), `version` | Moves the service back to an earlier version and restores that version's web build. Skips Terraform and migrations (section 7) |
| `.github/workflows/create-user.yml` | manual: `environment`, `role` (admin, or manager if P9), email, full name | Runs the one-off `create-user` task (section 5.6) |
| `.github/workflows/dev-demo-data.yml` | manual: `mode` (`load-if-empty` or `reset`), plus a typed confirmation `dev` for reset | Runs `seed-demo` in dev only (4.5) |
| `.github/workflows/dev-power.yml` | manual: `sleep` or `wake` (and an optional schedule if P4 changes) | Sets the dev service count to 0 or 1 and stops or starts the dev database |
| `.github/workflows/dependency-check.yml` | weekly and manual | `pip-audit` (B7), `npm audit`, Terraform provider check. Opens an issue on findings (B8). Plus `.github/dependabot.yml` for GitHub Actions, npm, uv and Docker base images |

All third-party actions are **pinned to a full commit SHA**, with the version in a comment, and
Dependabot updates them. `setup-uv` v8 no longer publishes `@v8` tags at all (verified). Each
workflow sets `permissions:` to the minimum (`contents: read`, plus `id-token: write` only on
jobs that talk to AWS). AWS jobs are skipped while `vars.AWS_DEV_ACCOUNT_ID` is empty, so CI is
useful before the bootstrap.

### 4.2 `ci` job graph (runs on every pull request and every push)

| Job | Steps |
|---|---|
| `backend` | `actions/checkout`, `astral-sh/setup-uv`, `uv sync --frozen`; **Postgres as a GitHub service container**: `postgres:16-alpine` (pinned digest), `POSTGRES_USER=jobproof`, `POSTGRES_PASSWORD=jobproof`, `POSTGRES_DB=jobproof_test`, port `5544:5432`, health option `pg_isready`. The Makefile's default `TEST_DATABASE_URL` (`127.0.0.1:5544/jobproof_test`) then works unchanged. Run ruff, format check, mypy and `uv run pytest`. The blackhole connect-timeout test that skips in the workspace runs here (B5) |
| `web` | `actions/setup-node` (Node 22), `npm ci`, `npm run lint`, `redocly lint`, `npm run gen:check`, `npm test`, `npm run build -w @jobproof/web` (includes the bundle origin check), busybox regression test for `web/nginx/*.sh` |
| `e2e` | `cp .env.example .env`; `make up` (the first real `docker compose` run: closes B4, verifies the nginx tag B6, pins image digests B3); `npx playwright install --with-deps chromium`; `make e2e`; upload the Playwright report on failure. GitHub's hosted runners have Docker. Claude's workspace does not, which is why this has never run |
| `infra` | `terraform fmt -check -recursive`, `terraform validate` for both envs, `tflint`, `cfn-lint` on the bootstrap file, `actionlint` on workflows, and the CSP parity test (5.5) |
| `plan` (pull requests only, after bootstrap) | Assume `jobproof-github-plan` in each account and run `terraform plan -lock=false` (read-only role). Post the plan summary to the job summary |

Rough runner time: about 20 minutes per push. The free plan's 2,000 private-repo minutes a month
cover roughly 100 pushes. Check GitHub's billing page if usage grows.

### 4.3 `pipeline.yml` on push to `main`

1. **ci**: as 4.2. If anything fails, nothing deploys.
2. **build** (no AWS): build the backend image once with buildx (GitHub Actions cache), tag it
   `<sha>` and save it as an artifact. Build the web `dist` once and save it as artifact
   `web-dist`.
3. **deploy-dev** (assumes the dev roles):
   1. First run only: create ECR (`-target=module.ecr`).
   2. Load the image and push `jobproof-backend:<sha>` to dev ECR. Record the digest.
   3. `terraform apply -var image_tag=<sha>` (infrastructure changes plus new task-definition
      revisions; the service does not move).
   4. Run one-off task **`db-roles`** and wait for exit code 0 (idempotent; section 5.4).
   5. Run one-off task **`migrate`** (`python -m app.cli migrate`: `alembic upgrade head`, then
      the app-role grants). Print its log. Exit code other than 0 stops the deploy, and the old
      version keeps serving.
   6. Run **`seed-demo --if-empty`** (dev only; a no-op unless the database has no users).
   7. `ecs update-service` to the new app revision, then `ecs wait services-stable`. If the new
      tasks fail health checks, the circuit breaker rolls back automatically and the job fails.
   8. Web: upload `assets/` first (immutable, never deleted in the same run), then generate
      `config.js` (5.5), then upload `index.html` and `config.js` with `no-cache`. Store
      `web/<sha>.tar.gz` in the releases bucket. Invalidate `/index.html` and `/config.js`.
      Asset files older than 30 days that the current release no longer references are removed
      by a later step, so users with an older open tab do not get 404s on code chunks.
   9. Write `/jobproof/dev/release = <sha>`.
   10. **Smoke test** against the dev URL: `/health` is 200 with `database: ok`;
       `/api/v1/branding` is 200; `/` serves `index.html` with the expected CSP header;
       `/config.js` contains the dev origin; `/api/v1/manager/dashboard` without a token is a
       401 `problem+json` (proves API errors are not rewritten to HTML); and one Playwright test
       opens the login page with no CSP violations.
4. **prod-preview**: `terraform plan` for prod with the read-only prod plan role. The summary
   shows "If you deploy `<sha>` to prod, Terraform will change: ..." This is what you read
   before clicking.

### 4.4 `deploy-prod.yml` (the manual approval)

You open **Actions**, click **Deploy to prod**, then **Run workflow**, and paste the SHA shown
as "running on dev". The workflow:

1. Checks that the SHA is on `main`, that `pipeline.yml` succeeded for it, and that it is the
   version on dev or an earlier one.
2. Copies the image **by digest** from dev ECR to prod ECR (the prod deploy role may pull from
   dev). Nothing is rebuilt. It downloads that run's `web-dist` artifact. Artifacts are kept 90
   days; promoting an older build means rebuilding it through the pipeline first.
3. Then the same steps as deploy-dev 3 to 10, **without** seed-demo, against prod.

If the repo is public (P1), we add `environment: prod` with you as required reviewer, and the
same workflow then also pauses for an Approve click.

### 4.5 Demo data in dev (seed refuses outside local and test)

The existing seed (`python -m app.seed`) **stays exactly as it is**: it truncates everything and
refuses unless `APP_ENV` is local or test. Dev gets a **separate**, dev-only entry point,
`python -m app.seed.demo`, which reuses the same dataset builder. It runs only when **all** of
these hold:

- `APP_ENV=staging` (refuses `production`; refuses `local` and `test`, where the normal seed
  applies);
- `DEMO_SEED_ALLOWED=true`, which only the dev task definition sets. The prod Terraform
  `tfvars` validation rejects it;
- `DEMO_PASSWORD` comes from Secrets Manager, has at least 16 characters, and is **not** any
  password in `backend/app/seed/catalogue.py`. The repository's demo passwords (`Manager123!`
  and others) are public, and dev is on the internet. All demo users get this one password. The
  emails stay `manager@jobproof.test`, `admin@jobproof.test`, and so on;
- mode `--if-empty`: loads only if the `users` table is empty, and otherwise exits 0 doing
  nothing. Mode `--reset` (manual workflow, typed confirmation): truncates and reloads, like the
  local seed, using the `jobproof.allow_audit_truncate` session setting. It must run as the
  **migrator** role, because the app role has no TRUNCATE (B11).

`DEMO_ACCOUNTS_ENABLED` stays false in dev (the config refuses it in staging), so the login
page lists no accounts. You read the password in Secrets Manager (section 1F). **Rule: no real
customer data in dev, ever.** Dates in the demo data are relative to the day it was loaded.
Run "reset" to refresh them.

### 4.6 Migrations on deploy: the rule

During a rolling deploy, the old version keeps serving while `migrate` runs. So **every
migration must work with the code version currently deployed** ("expand, then contract"): add
columns and tables first, remove them only in a later release. The code reviewer checks this on
every migration. Downgrades are **never** run in prod (0005's downgrade drops audit history).
Fixes go forward as new migrations. The first deploy runs 0001 to the head on an empty
database, so this rule matters only from the second deploy on.

## 5. Security

### 5.1 Who can do what

| Identity | Assumed by | Allowed |
|---|---|---|
| Paul (Identity Center, MFA) | you, in the browser | Admin in all three accounts; read-only permission set for looking around. This is also the break-glass route (section 7) |
| `jobproof-github-plan` (bootstrap) | `ci.yml` on pull requests, `prod-preview` | `ReadOnlyAccess`, plus read on the state bucket, **with explicit denies** on `s3:GetObject` for the photos, web and releases buckets, `secretsmanager:GetSecretValue`, `ssm:GetParameter*` on SecureStrings, `kms:Decrypt` and `logs:GetLogEvents`. A pull request can see the shape of the infrastructure but never data or secrets |
| `jobproof-github-terraform` (bootstrap) | dev: only `pipeline.yml` on `main`; prod: only `deploy-prod.yml` on `main` (P2) | AdministratorAccess. Terraform creates IAM roles, so it effectively needs admin. The control is **who** can assume it: OIDC trust on the repo, branch and workflow file, with audience `sts.amazonaws.com` |
| `jobproof-github-deploy` (Terraform) | the same workflows as above, plus `rollback`, `create-user`, `dev-demo-data`, `dev-power` | Only the narrow actions in the `ci_roles` row (section 3) |
| App execution role | ECS agent | Pull the image, write logs, read the **app** secrets only |
| Ops execution role | ECS agent for one-off tasks | Pull, logs, read the master, migrator, demo and admin-initial secrets |
| App and ops task roles | the running container | Nothing yet. Photos access is added with `S3PhotoStore` (later) |

OIDC trust conditions use the `sub` claim. With P2, the repository's subject template includes
`repo`, `context` and `job_workflow_ref`, so a role names the exact workflow file allowed to use
it. Without P2, the fallback is `repo:gallpaul8892/jobproof:ref:refs/heads/main` (pipeline
roles) and `...:pull_request` (plan role), and the main protection becomes code review of
`.github/workflows/`. Pull requests from forks never receive OIDC tokens. **No long-lived AWS
keys exist anywhere.**

### 5.2 Network and data

- RDS is in private DB subnets, `publicly_accessible = false`, and accepts connections only
  from the app and ops task security groups. There is **no public database and no bastion**.
  TLS is enforced by the server (`rds.force_ssl`), and the client uses `verify-full` against
  the RDS CA bundle, committed at `backend/certs/rds-global-bundle.pem` (a public certificate;
  the weekly job checks it against AWS's published copy).
- Storage is encrypted at rest: RDS, all S3 buckets and Secrets Manager.
- The ALB is internal and reachable only through CloudFront (section 2). Dev tasks have a public
  IP for outbound traffic only. Their security group allows inbound connections only from the
  ALB's security group.
- Web bucket: private, readable only by this distribution through **OAC** (bucket policy
  conditioned on the distribution ARN). The photos and releases buckets: private, no CloudFront.
- **Photos later:** `S3PhotoStore` issues presigned S3 URLs. If images load directly from S3,
  the CSP `img-src` must add the bucket's regional origin
  (`https://<bucket>.s3.eu-west-2.amazonaws.com`). The alternative is serving photos through a
  CloudFront behaviour with signed URLs, which keeps `'self'`. That decision belongs to the
  photo-upload spec. Today's placeholder photos are served by the backend under `/api/v1/photos`
  (same origin), so nothing changes now.

### 5.3 Backups

RDS automated backups with point-in-time restore: 7 days in dev, 14 in prod. Prod also has
deletion protection and a final snapshot on delete. The photos bucket is versioned, and so are
the state buckets. A cross-region backup copy (AWS Backup to eu-west-1) is a later option,
recorded as a deferral to revisit before real customer data. Restores are tested once in dev as
part of INFRA-6 (section 7).

### 5.4 B11: separate database roles (built in INFRA-3, used from the first deploy)

- `jobproof_master`: RDS master user, password managed and rotated by RDS. Used **only** by the
  `db-roles` task.
- `python -m app.cli db-roles` (new, idempotent): creates `jobproof_migrator` (LOGIN, owns the
  schema) and `jobproof_app` (LOGIN, owns nothing) if they are missing, and sets their passwords
  from their secrets.
- `python -m app.cli migrate` (new): runs `alembic upgrade head` as `jobproof_migrator`, then
  applies the grants idempotently. `jobproof_app` gets SELECT, INSERT, UPDATE and DELETE on
  business tables and USAGE on sequences. On `audit_events` it gets **only SELECT and INSERT**.
  It never gets TRUNCATE on any table, and it owns no table and no trigger function. That
  closes the B11 finding: `jobproof.allow_audit_truncate` is useless without TRUNCATE.
- Local and compose keep the single superuser. A new pytest module creates the two roles in the
  test database and asserts that the app role is refused UPDATE, DELETE and TRUNCATE on
  `audit_events` and TRUNCATE on `users` and `job_reports`, and that ordinary app operations
  still work.

### 5.5 Web runtime config and CSP under CloudFront

- `config.js` is generated in the pipeline by running the **existing**
  `web/nginx/40-jobproof-config.sh` with `DIST_DIR` and `HEADERS_FILE` pointing at temporary
  paths and `API_BASE_URL=https://<distribution domain>`. That reuses its strict origin
  validation (it is POSIX `sh` and runs on the Ubuntu runner).
- Headers are set by a CloudFront **response-headers policy**, not nginx. The CSP text lives in
  one file, `infra/terraform/modules/web_static/csp.txt`, read by Terraform's `file()`:
  `default-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
  Also `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, and `Strict-Transport-Security: max-age=31536000` (no preload).
- **Parity test** (Vitest, in `web/nginx/`): run the script with a same-origin API URL, parse
  both CSPs into directive sets, treat the API origin as `'self'`, and assert they are equal. A
  change to one without the other fails CI.
- The e2e CSP test keeps covering the local cross-origin policy. The dev smoke test covers the
  CloudFront policy.

### 5.6 First Admin and Managers

There is no seed in prod. `create-user.yml` runs the one-off `create-user` task:
`python -m app.cli create-admin ...` today, generalised to `create-user --role admin|manager`
if P9 is accepted. `ADMIN_INITIAL_PASSWORD` comes from the short-lived secret you create (1F).
The workflow deletes that secret after success (forced, no recovery window), and the task logs
only the user ID. There is still **no password-change screen**. Backlog B13: add one before
real users.

### 5.7 B12 and other items that must close before real customers ("go-live gate")

Prod can run without these, but real customer data and money must not enter it until they are
done: **B12** (snapshot the billing name and address onto invoices at issue, before invoice
documents or Stripe links exist), **B13** (password change and user management), **B1/B2**
(hardening), **B7** (`pip-audit` clean, automated from INFRA-2), the custom domain (P11), the
prod resilient size (P3), and a restore test of prod backups.

## 6. Cost estimate (GBP per month, excluding VAT)

Assumptions: on-demand prices, eu-west-2, 730 hours a month, $1 = £0.77, light traffic, 20 GB
database storage. Verified today: RDS PostgreSQL `db.t4g.micro` about $13 a month and
`db.t4g.small` about $26 a month in London (single-AZ list prices; Multi-AZ doubles the
instance price). AWS's own pages for London Fargate, ALB and NAT prices did not render, so
those lines use us-east-1 rates (verified, Fargate x86 about $0.0405 per vCPU-hour and $0.0044
per GB-hour) uplifted by about 15% for London. **Treat every figure as ±20%.** INFRA-4 adds an
AWS Pricing Calculator link. UK VAT (20%) is added on top unless you are VAT-registered.

| Item | dev (always on) | prod, smallest (P3 start) | prod, resilient |
|---|---|---|---|
| Fargate | 1 × 0.25 vCPU / 0.5 GB: £8 | same: £8 | 2 × 0.5 vCPU / 1 GB: £32 |
| Public IPv4 for tasks | £3 | n/a | n/a |
| NAT gateway (1) | none | £29 | £29 (+ data) |
| Internal ALB | £15 | £15 | £16 |
| RDS (instance + storage + backups) | micro, single-AZ: £12 | micro, single-AZ: £12 | small, Multi-AZ: £45 |
| Secrets Manager (6 to 7 secrets) | £2 | £2 | £2 |
| CloudWatch logs, metrics, alarms | £1 | £2 | £3 |
| CloudFront, S3, ECR, SSM, CloudTrail | £1 | £1 | £2 |
| WAF (P6) | none | £6 | £6 |
| GuardDuty (P7) | none | £3 | £4 |
| **Total** | **about £42 to £45** | **about £70** | **about £135 to £140** |

The management account costs £0 (Organizations, Identity Center, Budgets and Cost Anomaly
Detection are free). GitHub: £0 on the free plan. A domain later: about £10 a year, plus Route
53 at about £0.40 a month per zone.

**Ways to cut dev cost (largest first):**
1. **Destroy dev when unused for weeks** (`terraform destroy` through a manual workflow; the
   pipeline rebuilds it in about 15 to 20 minutes, with fresh demo data): about £1 a month
   while off.
2. **Sleep outside working hours** (`dev-power.yml`, P4): ECS to 0 and the database stopped
   from 19:00 to 07:00 and at weekends. Saves about £12, to about £32. RDS restarts a stopped
   database by itself after 7 days, so the schedule simply stops it again.
3. Keep dev without a NAT (already in the plan; saves £29). The ALB (£15) is the floor while
   dev exists, because CloudFront VPC origins need it.
4. Graviton (ARM) tasks are about 20% cheaper on a small line. Deferred until the images are
   built for arm64.

**Ways to cut prod cost:** stay at the smallest size until go-live (P3). One NAT instead of one
per zone (already in the plan; the trade-off is that losing that zone stops outbound calls, but
not serving). Running prod tasks in public subnets like dev would save the NAT (£29) at some
cost in defence in depth. Not recommended once real data arrives.

## 7. Rollback and break-glass

**A bad release (most common):**
- Automatic: if new tasks fail health checks, the ECS circuit breaker returns to the previous
  revision and the pipeline goes red. Nothing to do.
- Manual: Actions, **Rollback**, environment and the last good SHA (from the pipeline history),
  then **Run workflow**. It points the service at that version's task-definition revision (the
  image is still in ECR), restores that version's web build from the releases bucket, rewrites
  `config.js`, and invalidates. About 5 minutes. **It does not touch the database.** Because
  every migration is backward compatible (4.6), older code runs against the newer schema.
- If a migration itself is wrong: fix it forward with a new migration through the normal
  pipeline. Never `alembic downgrade` in prod.

**Data loss or corruption (rare):** point-in-time restore to a new RDS instance (console:
**RDS**, the database, **Actions**, **Restore to point in time**). Rename the broken instance,
then rename the restored one to the original name, so its address stays the same and no
configuration changes. INFRA-6 includes doing this once in dev, written up as a runbook in
`infra/README.md`.

**Break-glass (GitHub down, or the pipeline broken):**
1. Sign in at your access portal with AdministratorAccess. **CloudShell** (the `>_` icon in the
   console) gives a terminal in the browser with the AWS CLI. No laptop setup is needed.
2. Stop the bleeding: **ECS**, cluster, service, **Update service**, set desired tasks to 0
   (site down, data safe), or choose an earlier task-definition **revision** (that is a
   rollback).
3. Suspected GitHub compromise: **IAM**, **Identity providers**, delete
   `token.actions.githubusercontent.com` in both accounts. That instantly cuts off all GitHub
   access to AWS. Re-upload the bootstrap stack later to restore it.
4. Leaked application secret: **Secrets Manager**, the secret, **Rotate** or set a new value,
   then **ECS**, **Update service**, **Force new deployment**. Rotating `jwt-secret` signs
   everyone out, which is safe.
5. Shell into a running container (only if needed): set `enable_exec = true` for the
   environment through the pipeline, then use `aws ecs execute-command` from CloudShell. Turn it
   off afterwards.
6. Root user: management account only, MFA on, password in your password manager, used only for
   account recovery and billing emergencies. The member accounts have no root password (1B).

## 8. Work breakdown

Order: INFRA-1, INFRA-2 and INFRA-3 can run in parallel, then INFRA-4, INFRA-5, INFRA-6,
INFRA-7. INFRA-8 is later. None of it conflicts with the T-002 work: the built migrations 0007
(T-002n) and 0008 (T-002p), and 0009 if the optional T-002m is built, are simply part of the
chain the first deploy applies.

| Ticket | Content | Claude without AWS? | Needs Paul |
|---|---|---|---|
| **INFRA-1** Bootstrap template and runbook | `infra/bootstrap/bootstrap.cfn.yaml` (OIDC provider, state bucket, plan and terraform roles, parameters `Environment`, `GitHubOwner`, `GitHubRepo`, `SubjectMode`); runbook for section 1 in `infra/README.md`; `cfn-lint` clean | yes, fully | approve the spec |
| **INFRA-2** CI on GitHub | `ci.yml` (4.2), `dependency-check.yml`, `dependabot.yml`, pinned actions, image digests pinned (B3). Closes B3 to B8 once green | writes it; **the first run happens on GitHub** (no AWS) | none beyond the push |
| **INFRA-3** App readiness for AWS | Backend: `DB_*` settings as an alternative to `DATABASE_URL` (ECS can inject secret fields but cannot assemble a URL), `DB_SSLMODE`/`DB_SSLROOTCERT` with the committed RDS bundle, `GET /health/live` (contract change: unversioned, 200 `{status:"ok"}`, no DB check, so a database failover does not make the ALB kill every task), `app.cli db-roles`, `app.cli migrate` with grants and the B11 tests, `app.seed.demo` with its guards and tests, `create-user --role` (P9). Web/infra: `csp.txt` and the parity test, `infra/scripts/upload-web.sh` (upload order, `config.js`), smoke-test script. All tested locally with `scripts/dev.sh` | yes, fully | none |
| **INFRA-4** Terraform modules and envs | The modules in section 3, `envs/dev` and `envs/prod`, `fmt`/`validate`/`tflint` clean; verify the write-only argument and ephemeral random-password support in the chosen provider versions; pricing calculator link | writes and validates (provider download only); **cannot plan or apply** | none |
| **INFRA-5** Workflows | `pipeline.yml`, `deploy-prod.yml`, `rollback.yml`, `create-user.yml`, `dev-demo-data.yml`, `dev-power.yml`; `actionlint` clean; AWS jobs skip until bootstrap | writes; **cannot run AWS jobs** | none |
| **INFRA-6** First dev deploy | You do sections 1A to 1E (and P2). Then a push to `main` deploys dev. Claude reads the GitHub run logs and fixes forward. Restore test in dev; runbook finished | partly: Claude sees GitHub logs, not the AWS console | **yes**: 1A to 1E; you open the dev URL and sign in with the demo password |
| **INFRA-7** First prod deploy | Click **Deploy to prod**; 1F for the Admin (and a Manager if P9); check alarm emails arrive (confirm the SNS subscription email) | no | **yes** |
| **INFRA-8** (later) Custom domain | `dns` module: certificates, alternate domain, ALB HTTPS, TLS policy, `CORS`/`PUBLIC_API_BASE_URL`/`config.js` switch to the domain | yes, except DNS changes at the registrar | buy the domain; registrar or Route 53 steps |

## Spec template sections

- **Patterns:** no Gang of Four pattern is warranted. The demo seed reuses the dataset builder
  with the password passed in as an argument (a plain function parameter). `S3PhotoStore` will
  plug into the existing `PhotoStore` Strategy later. Terraform uses plain module composition.
- **Data:** no table changes. New database roles and grants (5.4). New SSM parameter
  `/jobproof/<env>/release`.
- **API:** add `GET /health/live` (INFRA-3, `x-ticket: INFRA-3`; the contract is edited when the
  ticket starts, not now). No other contract change. Base URL in AWS is the CloudFront origin
  plus `/api/v1`.
- **Backend:** INFRA-3 row. `create-admin` keeps working (it becomes an alias of
  `create-user --role admin`).
- **Shared:** no change. Generated client and adapter unchanged; the base URL still comes from
  runtime config.
- **Web:** no source change. `config.js` and headers come from the pipeline and CloudFront
  instead of nginx. The nginx image stays the local and e2e server.
- **Mobile:** not in scope. Later, the Expo build profiles take the API origin (the custom domain
  from P11) from Expo config. There is no CSP on mobile.
- **Infra / local:** local `docker compose` and `scripts/dev.sh` are unchanged. New
  `.env.example` entries (commented): the `DB_*` alternative and `DEMO_SEED_ALLOWED` (documented
  as dev-AWS-only).
- **Test notes:** CI runs the full existing suite plus new tests: B11 role permissions; seed-demo
  guards (refuses production, local, test, a missing flag, a short password, a repository
  password; `--if-empty` does nothing when users exist); `DB_*` URL assembly with special
  characters in the password (URL-encoded); `/health/live` returns 200 when the database is
  down; CSP parity; dev smoke checks (4.3 step 10), including a 401 that stays `problem+json`
  through CloudFront.
- **Out of scope:** multi-tenancy (D1), mobile builds and EAS, Stripe, `S3PhotoStore` and photo
  upload, cross-region disaster recovery, Graviton, Postgres 18 upgrade.

## Risks

1. **First Docker run happens in CI** (B4). Expect a round of fixes in INFRA-2 before AWS is
   involved at all.
2. **Prod migrations cannot be undone.** Mitigations: the expand/contract rule (4.6), review,
   dev runs every migration first, and point-in-time restore.
3. **OIDC subject customisation changes the `sub` claim for the whole repository.** It must be
   set before the roles are first used, and never changed afterwards without updating both
   bootstrap stacks.
4. **Write-only arguments and ephemeral resources** are recent Terraform features. If the
   provider versions lack one, the fallback is a generated value in state, mitigated by the
   state bucket being private, encrypted and readable only by the terraform role. INFRA-4
   verifies support first.
5. **One NAT gateway in prod** is a single-zone dependency for outbound calls.
6. **Dev is public.** It is protected by a strong secret demo password, and the rule is that no
   real data goes there.
7. **CloudFront address is not permanent** (P11). Buy the domain before mobile or customer
   links.

## Versions (verified 2026-11-08)

| Item | Version | Source / note |
|---|---|---|
| Terraform CLI | 1.17.1 (2026-10-28) | endoflife.date. ARCHITECTURE.md said 1.15.x: updated |
| Terraform AWS provider | 6.72.0 (2026-11-04) → `~> 6.72` | releases.sh |
| RDS PostgreSQL | 16.15 latest 16.x; standard support to 28 Feb 2029. 17.11 (to 28 Feb 2030), 18.6 (to 28 Feb 2031) also available | AWS RDS release calendar |
| `actions/checkout` | v6 | Dependabot bump PRs; release page not reachable today |
| `actions/setup-node` | v6 (6.4.0) | mirror of the repository tags |
| `astral-sh/setup-uv` | v8 (no major tags; pin full version or SHA) | release notes |
| `aws-actions/configure-aws-credentials` | v6 (6.3.0, 2026-09) | GitHub releases |
| `hashicorp/setup-terraform` | v4 (4.0.1) | GitHub releases |
| `docker/build-push-action` | v7 | mirror; exact latest patch **unverified** |
| `aws-actions/amazon-ecr-login` | v2 (2.0.2 seen) | **unverified** as latest |
| `actions/upload-artifact` / `download-artifact` | **not verified**. Cross-run download needs v4 or later | INFRA-2 checks |
| `random` provider (ephemeral `random_password`) | **not verified** | INFRA-4 checks |

INFRA-2 pins each action to the SHA of its latest release at build time, so the unverified rows
are settled then.
