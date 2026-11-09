# ECS cluster, API service and one-off task definitions (spec section 3, `ecs_service`).
#
# Terraform owns every task-definition setting. The image tag is an input. `terraform apply`
# registers new revisions but does NOT move the service (ignore_changes on task_definition): the
# pipeline runs db-roles, then migrate, and only then calls `ecs update-service`. A rollback moves
# the service back to an older revision without Terraform fighting it, which is why old revisions
# are kept (skip_destroy).
#
# Which database identity each task uses (INFRA-3 notes, spec 5.4):
#   db-roles     jobproof_master (RDS master secret)   creates the two roles
#   migrate      jobproof_migrator                      alembic upgrade head, then grants
#   seed-demo    jobproof_migrator (dev only)           --if-empty, or --reset (needs TRUNCATE)
#   create-user  jobproof_app                           inserts one user
#   api service  jobproof_app
# FIXED_NOW and SEED_ANCHOR_DATE are never set in AWS.

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region     = data.aws_region.current.region
  account_id = data.aws_caller_identity.current.account_id

  migrator_user = "jobproof_migrator"
  app_user      = "jobproof_app"
  ca_bundle     = "/app/certs/rds-global-bundle.pem" # copied into the image by backend/Dockerfile

  # Everything a task needs to load the backend settings (config.py reads DB_* as all-or-nothing,
  # and staging/production also require JWT_SECRET and PHOTO_URL_SECRET, so EVERY task gets them).
  db_env = {
    APP_ENV        = var.app_env
    DB_HOST        = var.db_host
    DB_PORT        = tostring(var.db_port)
    DB_NAME        = var.db_name
    DB_SSLMODE     = "verify-full"
    DB_SSLROOTCERT = local.ca_bundle
    LOG_LEVEL      = "INFO"
  }
  app_secrets = {
    JWT_SECRET       = var.secret_arns["jwt-secret"]
    PHOTO_URL_SECRET = var.secret_arns["photo-url-secret"]
  }

  # ---- the API task ---------------------------------------------------------------------------
  api_env = merge(local.db_env, {
    DB_USER               = local.app_user
    PUBLIC_API_BASE_URL   = var.public_origin
    CORS_ALLOWED_ORIGINS  = var.public_origin
    DEMO_ACCOUNTS_ENABLED = "false"
  })
  api_secrets = merge(local.app_secrets, {
    DB_PASSWORD = var.secret_arns["db-app-password"]
  })

  # ---- the one-off tasks ----------------------------------------------------------------------
  ops_tasks = merge(
    {
      "db-roles" = {
        log_group = aws_cloudwatch_log_group.ops.name
        command   = ["python", "-m", "app.cli", "db-roles"]
        env       = merge(local.db_env, { DB_USER = var.db_master_username })
        secrets = merge(local.app_secrets, {
          DB_PASSWORD          = "${var.db_master_secret_arn}:password::"
          DB_MIGRATOR_PASSWORD = var.secret_arns["db-migrator-password"]
          DB_APP_PASSWORD      = var.secret_arns["db-app-password"]
        })
      }
      "migrate" = {
        log_group = aws_cloudwatch_log_group.migrate.name
        command   = ["python", "-m", "app.cli", "migrate"]
        env = merge(local.db_env, {
          DB_USER              = local.migrator_user
          DEFAULT_COMPANY_NAME = var.default_company_name
        })
        secrets = merge(local.app_secrets, {
          DB_PASSWORD = var.secret_arns["db-migrator-password"]
        })
      }
      # The workflow overrides the command with real arguments (role, email, full name).
      # ADMIN_INITIAL_PASSWORD comes from the short-lived secret Paul creates (spec 1F).
      "create-user" = {
        log_group = aws_cloudwatch_log_group.ops.name
        command   = ["python", "-m", "app.cli", "create-user", "--help"]
        env       = merge(local.db_env, { DB_USER = local.app_user })
        secrets = merge(local.app_secrets, {
          DB_PASSWORD            = var.secret_arns["db-app-password"]
          ADMIN_INITIAL_PASSWORD = var.admin_initial_password_name # by name (same region): the secret has no ARN suffix yet when this is planned
        })
      }
    },
    # dev only. Default command is --if-empty; the dev-demo-data workflow overrides it with
    # --reset. --reset must run as the migrator (the app role has no TRUNCATE, B11).
    var.demo_seed_allowed ? {
      "seed-demo" = {
        log_group = aws_cloudwatch_log_group.ops.name
        command   = ["python", "-m", "app.seed.demo", "--if-empty"]
        env = merge(local.db_env, {
          DB_USER           = local.migrator_user
          DEMO_SEED_ALLOWED = "true"
        })
        secrets = merge(local.app_secrets, {
          DB_PASSWORD   = var.secret_arns["db-migrator-password"]
          DEMO_PASSWORD = lookup(var.secret_arns, "demo-password", "")
        })
      }
    } : {},
  )
}

# =============================================================================================
# Logs and cluster
# =============================================================================================

resource "aws_cloudwatch_log_group" "api" {
  name              = "/jobproof/${var.environment}/api"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/jobproof/${var.environment}/migrate"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "ops" {
  name              = "/jobproof/${var.environment}/ops"
  retention_in_days = var.log_retention_days
}

resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = var.container_insights ? "enabled" : "disabled"
  }
}

# =============================================================================================
# Security groups
# =============================================================================================

resource "aws_security_group" "app" {
  name_prefix = "${var.name}-app-"
  description = "Backend API tasks: inbound from the ALB only"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name}-app" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "ops" {
  name_prefix = "${var.name}-ops-"
  description = "One-off tasks: no inbound at all"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name}-ops" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  referenced_security_group_id = var.alb_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 8000
  to_port                      = 8000
  description                  = "API port from the internal ALB"
}

locals {
  task_security_groups = {
    app = aws_security_group.app.id
    ops = aws_security_group.ops.id
  }
}

# Outbound: HTTPS (ECR, Secrets Manager, CloudWatch Logs) and PostgreSQL inside the VPC.
resource "aws_vpc_security_group_egress_rule" "https" {
  for_each = local.task_security_groups

  security_group_id = each.value
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  description       = "HTTPS to AWS APIs"
}

resource "aws_vpc_security_group_egress_rule" "postgres" {
  for_each = local.task_security_groups

  security_group_id = each.value
  cidr_ipv4         = var.vpc_cidr
  ip_protocol       = "tcp"
  from_port         = 5432
  to_port           = 5432
  description       = "PostgreSQL inside the VPC"
}

# =============================================================================================
# IAM: two execution roles (who reads which secrets) and two empty task roles
# =============================================================================================

data "aws_iam_policy_document" "ecs_tasks_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "app_execution" {
  name               = "${var.name}-app-exec"
  description        = "ECS agent for the API service: pull the image, write logs, read the APP secrets only"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

resource "aws_iam_role" "ops_execution" {
  name               = "${var.name}-ops-exec"
  description        = "ECS agent for one-off tasks: also reads the master, migrator, demo and admin-initial secrets"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

resource "aws_iam_role" "app_task" {
  name               = "${var.name}-app-task"
  description        = "The running API container. No permissions yet (photos access arrives with S3PhotoStore)"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

resource "aws_iam_role" "ops_task" {
  name               = "${var.name}-ops-task"
  description        = "The running one-off containers. No permissions"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

locals {
  app_secret_arns = [
    var.secret_arns["jwt-secret"],
    var.secret_arns["photo-url-secret"],
    var.secret_arns["db-app-password"],
  ]
  # Deviation from the spec's ops row (master, migrator, demo, admin-initial): every task loads the
  # backend settings, which need JWT_SECRET, PHOTO_URL_SECRET and DB_PASSWORD, so the ops role
  # reads the app secrets too.
  ops_secret_arns = concat(
    values(var.secret_arns),
    [
      var.db_master_secret_arn,
      "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:${var.admin_initial_password_name}-*",
    ],
  )
}

data "aws_iam_policy_document" "execution_common" {
  statement {
    sid       = "EcrToken"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [var.repository_arn]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [for group in [aws_cloudwatch_log_group.api, aws_cloudwatch_log_group.migrate, aws_cloudwatch_log_group.ops] : "${group.arn}:*"]
  }
}

data "aws_iam_policy_document" "app_execution" {
  source_policy_documents = [data.aws_iam_policy_document.execution_common.json]

  statement {
    sid       = "AppSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.app_secret_arns
  }
}

data "aws_iam_policy_document" "ops_execution" {
  source_policy_documents = [data.aws_iam_policy_document.execution_common.json]

  statement {
    sid       = "OpsSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.ops_secret_arns
  }
}

resource "aws_iam_role_policy" "app_execution" {
  name   = "execution"
  role   = aws_iam_role.app_execution.id
  policy = data.aws_iam_policy_document.app_execution.json
}

resource "aws_iam_role_policy" "ops_execution" {
  name   = "execution"
  role   = aws_iam_role.ops_execution.id
  policy = data.aws_iam_policy_document.ops_execution.json
}

# ECS Exec (break-glass) needs the SSM messages channel on the TASK role.
data "aws_iam_policy_document" "exec_channel" {
  statement {
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "app_task_exec" {
  count = var.enable_exec ? 1 : 0

  name   = "ecs-exec"
  role   = aws_iam_role.app_task.id
  policy = data.aws_iam_policy_document.exec_channel.json
}

# =============================================================================================
# Task definitions
# =============================================================================================

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.app_execution.arn
  task_role_arn            = aws_iam_role.app_task.arn
  skip_destroy             = true # keep old revisions so a rollback can point at them

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "api"
    image     = var.image
    essential = true
    # No command: the image's CMD runs uvicorn on 8000 with graceful shutdown.
    portMappings = [{ containerPort = 8000, protocol = "tcp" }]
    environment  = [for k, v in local.api_env : { name = k, value = v }]
    secrets      = [for k, v in local.api_secrets : { name = k, valueFrom = v }]
    stopTimeout  = 30
    linuxParameters = {
      initProcessEnabled = true
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = local.region
        "awslogs-stream-prefix" = "api"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "ops" {
  for_each = local.ops_tasks

  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.ops_cpu
  memory                   = var.ops_memory
  execution_role_arn       = aws_iam_role.ops_execution.arn
  task_role_arn            = aws_iam_role.ops_task.arn
  skip_destroy             = true

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name        = each.key
    image       = var.image
    essential   = true
    command     = each.value.command
    environment = [for k, v in each.value.env : { name = k, value = v }]
    secrets     = [for k, v in each.value.secrets : { name = k, valueFrom = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = each.value.log_group
        "awslogs-region"        = local.region
        "awslogs-stream-prefix" = each.key
      }
    }
  }])

  lifecycle {
    precondition {
      condition     = each.key != "seed-demo" || lookup(var.secret_arns, "demo-password", "") != ""
      error_message = "seed-demo needs the demo-password secret (create_demo_password = true in the secrets module)."
    }
  }
}

# =============================================================================================
# Service
# =============================================================================================

resource "aws_ecs_service" "api" {
  name            = "${var.name}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  platform_version                   = "LATEST"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  enable_execute_command             = var.enable_exec
  propagate_tags                     = "SERVICE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "api"
    container_port   = 8000
  }

  lifecycle {
    # The pipeline moves the service (after migrate succeeds) and dev-power / autoscaling change
    # the count. Terraform must not undo either.
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_iam_role_policy.app_execution]
}

resource "aws_appautoscaling_target" "api" {
  count = var.autoscaling_max_count > 0 ? 1 : 0

  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.api.name}"
  min_capacity       = var.desired_count
  max_capacity       = var.autoscaling_max_count
}

resource "aws_appautoscaling_policy" "cpu" {
  count = var.autoscaling_max_count > 0 ? 1 : 0

  name               = "${var.name}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api[0].service_namespace
  scalable_dimension = aws_appautoscaling_target.api[0].scalable_dimension
  resource_id        = aws_appautoscaling_target.api[0].resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
