# One environment = these modules with this environment's terraform.tfvars (spec section 3).
# First run only: `terraform apply -target=module.ecr`, so the image can be pushed. That is the
# single documented use of -target (README).

provider "aws" {
  region              = var.aws_region
  allowed_account_ids = length(var.allowed_account_ids) > 0 ? var.allowed_account_ids : null

  default_tags {
    tags = {
      Project     = "jobproof"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# WAF for CloudFront exists only in us-east-1. (ACM for CloudFront will need it too, INFRA-8.)
provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = length(var.allowed_account_ids) > 0 ? var.allowed_account_ids : null

  default_tags {
    tags = {
      Project     = "jobproof"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  name       = "jobproof-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region

  release_param_name = "/jobproof/${var.environment}/release"
  image_tag          = var.image_tag

  is_dev  = var.environment == "dev"
  is_prod = var.environment == "prod"

  # Image promotion (dev -> prod). See variables.tf.
  ecr_pull_from_role_arn          = local.is_dev && var.promotion_peer_account_id != "" ? "arn:aws:iam::${var.promotion_peer_account_id}:role/jobproof-github-deploy" : ""
  promotion_source_repository_arn = local.is_prod && var.promotion_peer_account_id != "" ? "arn:aws:ecr:${local.region}:${var.promotion_peer_account_id}:repository/jobproof-backend" : ""
}

module "account_baseline" {
  source = "../../modules/account_baseline"

  name             = local.name
  account_id       = local.account_id
  enable_guardduty = var.enable_guardduty
  force_destroy    = var.force_destroy_buckets
}

module "network" {
  source = "../../modules/network"

  name               = local.name
  vpc_cidr           = var.vpc_cidr
  enable_nat_gateway = var.enable_nat_gateway
}

module "ecr" {
  source = "../../modules/ecr"

  pull_from_role_arn = local.ecr_pull_from_role_arn
}

module "secrets" {
  source = "../../modules/secrets"

  environment             = var.environment
  create_demo_password    = var.demo_seed_allowed
  recovery_window_in_days = var.secret_recovery_window_days
  secret_versions         = var.secret_versions
}

module "alb" {
  source = "../../modules/alb"

  name                = local.name
  vpc_id              = module.network.vpc_id
  vpc_cidr            = module.network.vpc_cidr
  subnet_ids          = module.network.app_subnet_ids
  deletion_protection = var.alb_deletion_protection
}

module "rds" {
  source = "../../modules/rds"

  name                    = local.name
  vpc_id                  = module.network.vpc_id
  db_subnet_ids           = module.network.db_subnet_ids
  allowed_security_groups = module.ecs_service.db_client_security_groups
  instance_class          = var.db_instance_class
  multi_az                = var.db_multi_az
  allocated_storage_gb    = var.db_allocated_storage_gb
  backup_retention_days   = var.db_backup_retention_days
  deletion_protection     = var.db_deletion_protection
  final_snapshot          = var.db_final_snapshot
  apply_immediately       = var.db_apply_immediately
}

module "photos_bucket" {
  source = "../../modules/photos_bucket"

  bucket_name   = "${local.name}-photos-${local.account_id}"
  force_destroy = var.force_destroy_buckets
}

module "waf" {
  count  = var.enable_waf ? 1 : 0
  source = "../../modules/waf"

  providers = {
    aws = aws.us_east_1
  }

  name               = local.name
  managed_rules_mode = var.waf_managed_rules_mode
}

module "web_static" {
  source = "../../modules/web_static"

  name                 = local.name
  web_bucket_name      = "${local.name}-web-${local.account_id}"
  releases_bucket_name = "${local.name}-releases-${local.account_id}"
  alb_arn              = module.alb.arn
  alb_dns_name         = module.alb.dns_name
  price_class          = var.cloudfront_price_class
  web_acl_arn          = var.enable_waf ? module.waf[0].web_acl_arn : null
  force_destroy        = var.force_destroy_buckets
}

module "ecs_service" {
  source = "../../modules/ecs_service"

  name                        = local.name
  environment                 = var.environment
  app_env                     = var.app_env
  vpc_id                      = module.network.vpc_id
  vpc_cidr                    = module.network.vpc_cidr
  subnet_ids                  = module.network.task_subnet_ids
  assign_public_ip            = module.network.task_assign_public_ip
  alb_security_group_id       = module.alb.security_group_id
  target_group_arn            = module.alb.target_group_arn
  image                       = "${module.ecr.repository_url}:${local.image_tag}"
  repository_arn              = module.ecr.repository_arn
  cpu                         = var.task_cpu
  memory                      = var.task_memory
  desired_count               = var.desired_count
  autoscaling_max_count       = var.autoscaling_max_count
  log_retention_days          = var.log_retention_days
  enable_exec                 = var.enable_exec
  db_host                     = module.rds.address
  db_port                     = module.rds.port
  db_name                     = module.rds.database_name
  db_master_username          = module.rds.master_username
  db_master_secret_arn        = module.rds.master_user_secret_arn
  secret_arns                 = module.secrets.arns
  admin_initial_password_name = module.secrets.admin_initial_password_name
  public_origin               = module.web_static.origin
  default_company_name        = var.default_company_name
  demo_seed_allowed           = var.demo_seed_allowed
}

module "monitoring" {
  source = "../../modules/monitoring"

  name                    = local.name
  alarm_email             = var.alarm_email
  enable_alarms           = var.enable_alarms
  alb_arn_suffix          = module.alb.arn_suffix
  target_group_arn_suffix = module.alb.target_group_arn_suffix
  db_instance_identifier  = module.rds.identifier
  min_healthy_tasks       = var.desired_count
}

module "ci_roles" {
  source = "../../modules/ci_roles"

  environment                     = var.environment
  github_owner                    = var.github_owner
  github_repo                     = var.github_repo
  github_owner_id                 = var.github_owner_id
  github_repo_id                  = var.github_repo_id
  subject_mode                    = var.oidc_subject_mode
  allowed_workflows               = var.deploy_workflows
  ecr_repository_arn              = module.ecr.repository_arn
  promotion_source_repository_arn = local.promotion_source_repository_arn
  cluster_arn                     = module.ecs_service.cluster_arn
  service_name                    = module.ecs_service.service_name
  task_definition_family_prefix   = module.ecs_service.task_definition_family_prefix
  pass_role_arns                  = concat(module.ecs_service.task_role_arns, module.ecs_service.execution_role_arns)
  web_bucket_arn                  = module.web_static.web_bucket_arn
  releases_bucket_arn             = module.web_static.releases_bucket_arn
  distribution_arn                = module.web_static.distribution_arn
  log_group_arns                  = module.ecs_service.log_group_arns
  db_instance_arn                 = local.is_dev ? module.rds.arn : ""
}
