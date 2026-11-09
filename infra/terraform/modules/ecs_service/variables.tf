variable "name" {
  description = "Name prefix, for example jobproof-dev."
  type        = string
}

variable "environment" {
  description = "dev or prod."
  type        = string
}

variable "app_env" {
  description = "APP_ENV for the backend: staging (dev) or production (prod)."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.app_env)
    error_message = "app_env must be staging or production (the backend accepts local and test only outside AWS)."
  }
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  type = string
}

variable "subnet_ids" {
  description = "Where tasks run (the network module's task_subnet_ids)."
  type        = list(string)
}

variable "assign_public_ip" {
  description = "true in dev (public subnets, no NAT). The task security group still admits only the ALB."
  type        = bool
}

variable "alb_security_group_id" {
  type = string
}

variable "target_group_arn" {
  type = string
}

variable "image" {
  description = "Full image reference, <repository url>:<tag>. The tag is the git commit SHA."
  type        = string
}

variable "repository_arn" {
  description = "ECR repository the execution roles may pull from."
  type        = string
}

variable "cpu" {
  description = "Fargate CPU units for the API task: 256 (0.25 vCPU) or 512."
  type        = number
  default     = 256
}

variable "memory" {
  description = "MiB for the API task: 512 or 1024."
  type        = number
  default     = 512
}

variable "ops_cpu" {
  description = "One-off tasks (db-roles, migrate, seed-demo, create-user). Billed per run, a few minutes at a time. Argon2 hashing wants the memory."
  type        = number
  default     = 512
}

variable "ops_memory" {
  type    = number
  default = 1024
}

variable "desired_count" {
  description = "Initial and minimum task count. Later changes by the pipeline (dev-power) or autoscaling are ignored by Terraform."
  type        = number
  default     = 1
}

variable "autoscaling_max_count" {
  description = "0 turns CPU autoscaling off. Prod resilient size: 4."
  type        = number
  default     = 0
}

variable "autoscaling_cpu_target" {
  type    = number
  default = 60
}

variable "log_retention_days" {
  type = number

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "log_retention_days must be a value CloudWatch Logs accepts (for example 14 or 90)."
  }
}

variable "container_insights" {
  type    = bool
  default = false
}

variable "enable_exec" {
  description = "Break-glass: ECS Exec on the API service (spec section 7). Off by default; turn it off again afterwards."
  type        = bool
  default     = false
}

variable "db_host" {
  type = string
}

variable "db_port" {
  type    = number
  default = 5432
}

variable "db_name" {
  type = string
}

variable "db_master_username" {
  type = string
}

variable "db_master_secret_arn" {
  description = "RDS-managed secret {username, password}. Read only by the db-roles task."
  type        = string
}

variable "secret_arns" {
  description = "From the secrets module: jwt-secret, photo-url-secret, db-app-password, db-migrator-password, demo-password (dev)."
  type        = map(string)
}

variable "admin_initial_password_name" {
  description = "Name of the hand-made secret read by create-user (spec 1F)."
  type        = string
}

variable "public_origin" {
  description = "https://<distribution domain>. PUBLIC_API_BASE_URL and CORS_ALLOWED_ORIGINS."
  type        = string
}

variable "default_company_name" {
  description = "DEFAULT_COMPANY_NAME for the migrate task: the first company name (P8). The Admin can rename it in the app."
  type        = string
  default     = "Arbour Services"

  validation {
    condition     = length(trimspace(var.default_company_name)) >= 1 && length(var.default_company_name) <= 60
    error_message = "default_company_name must be 1 to 60 characters (the migration refuses anything longer)."
  }
}

variable "demo_seed_allowed" {
  description = <<-EOT
    Creates the dev-only seed-demo task definition with DEMO_SEED_ALLOWED=true and DEMO_PASSWORD.
    Refused when app_env is production (the backend refuses it too: spec 4.5).
  EOT
  type        = bool
  default     = false

  validation {
    condition     = !(var.demo_seed_allowed && var.app_env == "production")
    error_message = "DEMO_SEED_ALLOWED must never be set for production (INFRA spec 4.5)."
  }
}
