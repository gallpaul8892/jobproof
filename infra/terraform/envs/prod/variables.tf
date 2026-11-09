# This file, main.tf, outputs.tf and versions.tf are IDENTICAL in envs/dev and envs/prod
# (infra/terraform/check-env-parity.sh enforces it). The two environments differ only in
# terraform.tfvars, backend.tf and prod's guard.tf.

# ---- identity ---------------------------------------------------------------------------------

variable "environment" {
  description = "dev or prod. Names, secrets and the SSM release parameter derive from it."
  type        = string

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod."
  }
}

variable "app_env" {
  description = "Backend APP_ENV: staging for dev, production for prod. (The backend accepts only local, test, staging, production.)"
  type        = string

  validation {
    condition     = (var.environment == "dev" && var.app_env == "staging") || (var.environment == "prod" && var.app_env == "production")
    error_message = "dev must use app_env = staging and prod must use app_env = production."
  }
}

variable "aws_region" {
  type    = string
  default = "eu-west-2"

  validation {
    condition     = var.aws_region == "eu-west-2"
    error_message = "JobProof runs in Europe (London), eu-west-2, everywhere."
  }
}

variable "allowed_account_ids" {
  description = "Safety net: the AWS provider refuses to run against any other account. The workflows pass the account ID with -var."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for id in var.allowed_account_ids : can(regex("^[0-9]{12}$", id))])
    error_message = "Each allowed account ID must be 12 digits."
  }
}

variable "promotion_peer_account_id" {
  description = <<-EOT
    The OTHER account, for image promotion. In dev: the prod account ID, so dev's ECR lets the
    prod deploy role pull. In prod: the dev account ID, so the prod deploy role may pull from
    dev's repository. Empty until both accounts exist (the pipeline then cannot promote yet).
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.promotion_peer_account_id == "" || can(regex("^[0-9]{12}$", var.promotion_peer_account_id))
    error_message = "promotion_peer_account_id must be empty or 12 digits."
  }
}

# ---- network and compute ----------------------------------------------------------------------

variable "vpc_cidr" {
  type = string
}

variable "enable_nat_gateway" {
  description = "dev false (tasks in public subnets), prod true (tasks in private subnets, one NAT)."
  type        = bool
}

variable "task_cpu" {
  type    = number
  default = 256
}

variable "task_memory" {
  type    = number
  default = 512
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "autoscaling_max_count" {
  type    = number
  default = 0
}

variable "log_retention_days" {
  type = number
}

variable "enable_exec" {
  description = "Break-glass ECS Exec (spec section 7). Leave false."
  type        = bool
  default     = false
}

variable "alb_deletion_protection" {
  type    = bool
  default = false
}

variable "image_tag" {
  description = <<-EOT
    Backend image tag (the git commit SHA). Empty: use the SSM parameter /jobproof/<env>/release,
    which the pipeline writes after each successful deploy, so a plain plan shows no image change.
    The workflows pass -var image_tag=<sha>.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]{0,128}$", var.image_tag))
    error_message = "image_tag may contain letters, digits, dot, dash and underscore only."
  }
}

variable "default_company_name" {
  description = "First company name for a new database (decision P8). The Admin can rename it in the app."
  type        = string
  default     = "Arbour Services"
}

# ---- database ---------------------------------------------------------------------------------

variable "db_instance_class" {
  type = string
}

variable "db_multi_az" {
  type = bool
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_backup_retention_days" {
  type = number
}

variable "db_deletion_protection" {
  type = bool
}

variable "db_final_snapshot" {
  type = bool
}

variable "db_apply_immediately" {
  type    = bool
  default = false
}

# ---- secrets and demo data --------------------------------------------------------------------

variable "secret_recovery_window_days" {
  description = "0 in dev (names can be reused after a destroy), 30 in prod."
  type        = number
}

variable "secret_versions" {
  description = "Raise a value to rotate that generated secret (see the secrets module)."
  type        = map(number)
  default     = {}
}

variable "demo_seed_allowed" {
  description = <<-EOT
    DEMO_SEED_ALLOWED: dev only. true creates the demo-password secret and the seed-demo task
    definition. A production environment REJECTS true here (INFRA spec 4.5); the backend refuses
    it as well.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = !(var.demo_seed_allowed && (var.environment == "prod" || var.app_env == "production"))
    error_message = "DEMO_SEED_ALLOWED must not be set in production: remove demo_seed_allowed from the prod tfvars."
  }
}

# ---- edge, security, monitoring ---------------------------------------------------------------

variable "cloudfront_price_class" {
  type    = string
  default = "PriceClass_100"
}

variable "enable_waf" {
  description = "Decision P6: prod only. Rate limit on sign-in and the AWS common rule set."
  type        = bool
  default     = false
}

variable "waf_managed_rules_mode" {
  description = "count first, then block once the logs look clean."
  type        = string
  default     = "count"
}

variable "enable_guardduty" {
  description = "Decision P7: prod only."
  type        = bool
  default     = false
}

variable "enable_alarms" {
  type = bool
}

variable "alarm_email" {
  description = "Receives alarms and cost-anomaly emails. Not a secret, but not committed as a real address by default: set it in terraform.tfvars."
  type        = string
}

variable "force_destroy_buckets" {
  description = "dev only: a destroy may remove buckets that still hold objects."
  type        = bool
  default     = false
}

# ---- GitHub deploy role -----------------------------------------------------------------------

variable "github_owner" {
  type    = string
  default = "gallpaul8892"
}

variable "github_repo" {
  type    = string
  default = "jobproof"
}

variable "oidc_subject_mode" {
  description = "workflow (decision P2) or branch. Must match the bootstrap stack's SubjectMode."
  type        = string
  default     = "workflow"
}

variable "deploy_workflows" {
  description = "Workflow files that may assume jobproof-github-deploy in this account."
  type        = list(string)
}
