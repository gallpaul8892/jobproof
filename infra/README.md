# infra

No infrastructure code yet (later phase). This file records the plan.

Decision: **Terraform** (>= 1.15, AWS provider ~> 6.72). Reasons and trade-offs are in
[ARCHITECTURE.md](../ARCHITECTURE.md) section 11; the AWS layout is in section 9.

## Layout

```
infra/terraform/
  modules/<module>/
  envs/staging/
  envs/prod/
```

One state per environment, stored in S3 with its native lock file.

## Modules

| Module | Contents |
|---|---|
| `network` | VPC, 2 AZs, public/private-app/private-db subnets, NAT gateway, VPC endpoints (ECR, logs, Secrets Manager, S3) |
| `ecr` | Backend repository, scan on push, lifecycle policy |
| `rds` | Postgres 16, private DB subnets, SG from ECS only, encryption, automated backups, Multi-AZ in prod, credentials in Secrets Manager |
| `secrets` | `DATABASE_URL`, `JWT_SECRET`, `PHOTO_URL_SECRET` (Secrets Manager), KMS key |
| `alb` | Public ALB, ACM cert, HTTPS listener, HTTP redirect, target group health check `/health` |
| `ecs_service` | Cluster, task definition (env + secrets), service with rolling deploy and circuit breaker, autoscaling, CloudWatch log group, task and execution roles, migration task definition |
| `web_static` | Private S3 bucket, CloudFront with OAC, SPA error mapping to `/index.html`, response headers policy |
| `photos_bucket` | Private S3 bucket for photos (later phase), CORS for presigned PUT/GET |
| `ci_roles` | GitHub OIDC provider and roles: terraform plan (read-only), terraform apply, backend deploy (ECR push, ECS run-task/update-service), web deploy (S3 sync, CloudFront invalidation) |
| `dns` (optional) | Route 53 records for web and API |

## Deploy flow

CI builds the backend image, pushes it to ECR, runs a one-off ECS task `alembic upgrade head`,
then updates the service (rolling). The web build goes to S3 behind CloudFront with a
per-environment `config.js` uploaded with `Cache-Control: no-cache`.
