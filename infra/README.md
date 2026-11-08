# infra

No infrastructure code yet. The plan (awaiting Paul's approval) is
[specs/INFRA-aws-pipeline.md](../specs/INFRA-aws-pipeline.md); the summary and decisions are in
[ARCHITECTURE.md](../ARCHITECTURE.md) section 10.

Decision: **Terraform** (1.17.x, AWS provider `~> 6.72`) for everything except the
per-account bootstrap, which is one CloudFormation file uploaded in the console
(`bootstrap/bootstrap.cfn.yaml`, ticket INFRA-1).

Planned layout:

```
infra/
  bootstrap/bootstrap.cfn.yaml
  terraform/modules/<module>/
  terraform/envs/dev/     # APP_ENV=staging
  terraform/envs/prod/    # APP_ENV=production
  scripts/                # deploy helpers used by the GitHub workflows
```

The runbook (account setup, first deploy, rollback, restore, break-glass) will live here once
INFRA-1 and INFRA-6 are built.
