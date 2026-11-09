# Narrow deploy role `jobproof-github-deploy` (spec section 3, `ci_roles`, and 5.1).
# Terraform itself runs as jobproof-github-terraform (from the bootstrap stack). This role is what
# the deploy steps of the workflows use: push the image, run one-off tasks, move the service,
# upload the web build, invalidate CloudFront, record the release.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region
  repo       = "${var.github_owner}/${var.github_repo}"

  # Same subject format as the bootstrap template (infra/bootstrap/bootstrap.cfn.yaml).
  subjects = var.subject_mode == "workflow" ? [
    for wf in var.allowed_workflows :
    "repo:${local.repo}:ref:refs/heads/main:job_workflow_ref:${local.repo}/.github/workflows/${wf}@refs/heads/main"
  ] : ["repo:${local.repo}:ref:refs/heads/main"]

  service_arn   = "arn:aws:ecs:${local.region}:${local.account_id}:service/${element(split("/", var.cluster_arn), 1)}/${var.service_name}"
  task_def_arn  = "arn:aws:ecs:${local.region}:${local.account_id}:task-definition/${var.task_definition_family_prefix}-*:*"
  task_arn      = "arn:aws:ecs:${local.region}:${local.account_id}:task/${element(split("/", var.cluster_arn), 1)}/*"
  release_param = "arn:aws:ssm:${local.region}:${local.account_id}:parameter/jobproof/${var.environment}/release"
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.subjects
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "jobproof-github-deploy"
  description          = "GitHub Actions deploy steps: image, one-off tasks, service, web build. No Terraform, no secrets."
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  # ---- images ---------------------------------------------------------------------------------
  statement {
    sid       = "EcrToken"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPushPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [var.ecr_repository_arn]
  }

  dynamic "statement" {
    for_each = var.promotion_source_repository_arn == "" ? [] : [1]
    content {
      sid = "PromotionPullFromDev"
      actions = [
        "ecr:BatchCheckLayerAvailability",
        "ecr:BatchGetImage",
        "ecr:DescribeImages",
        "ecr:GetDownloadUrlForLayer",
      ]
      resources = [var.promotion_source_repository_arn]
    }
  }

  # ---- ECS: run the one-off tasks, move the service -------------------------------------------
  statement {
    sid       = "EcsRunOneOffTasks"
    actions   = ["ecs:RunTask"]
    resources = [local.task_def_arn]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [var.cluster_arn]
    }
  }

  statement {
    sid       = "EcsTasks"
    actions   = ["ecs:DescribeTasks", "ecs:StopTask"]
    resources = [local.task_arn]
  }

  statement {
    sid       = "EcsListTasks"
    actions   = ["ecs:ListTasks"]
    resources = ["*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [var.cluster_arn]
    }
  }

  statement {
    sid       = "EcsService"
    actions   = ["ecs:DescribeServices", "ecs:UpdateService"]
    resources = [local.service_arn]
  }

  # Read-only calls that do not support resource-level permissions.
  statement {
    sid       = "EcsDescribeTaskDefinitions"
    actions   = ["ecs:DescribeTaskDefinition", "ecs:ListTaskDefinitions"]
    resources = ["*"]
  }

  statement {
    sid       = "PassTaskRolesToEcsOnly"
    actions   = ["iam:PassRole"]
    resources = var.pass_role_arns

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # ---- web build ------------------------------------------------------------------------------
  statement {
    sid = "WebAndReleasesObjects"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${var.web_bucket_arn}/*", "${var.releases_bucket_arn}/*"]
  }

  statement {
    sid       = "WebAndReleasesList"
    actions   = ["s3:GetBucketLocation", "s3:ListBucket"]
    resources = [var.web_bucket_arn, var.releases_bucket_arn]
  }

  statement {
    sid       = "InvalidateCloudFront"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [var.distribution_arn]
  }

  # ---- release record and logs ----------------------------------------------------------------
  statement {
    sid       = "ReleaseParameter"
    actions   = ["ssm:GetParameter", "ssm:PutParameter"]
    resources = [local.release_param]
  }

  statement {
    sid       = "ReadOneOffTaskLogs"
    actions   = ["logs:FilterLogEvents", "logs:GetLogEvents"]
    resources = [for arn in var.log_group_arns : "${arn}:*"]
  }

  statement {
    sid       = "DescribeLogStreams"
    actions   = ["logs:DescribeLogStreams"]
    resources = var.log_group_arns
  }

  # ---- dev only: dev-power stops and starts the database ----------------------------------------
  dynamic "statement" {
    for_each = var.db_instance_arn == "" ? [] : [1]
    content {
      sid       = "DevDatabasePower"
      actions   = ["rds:DescribeDBInstances", "rds:StartDBInstance", "rds:StopDBInstance"]
      resources = [var.db_instance_arn]
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
