variable "environment" {
  description = "dev or prod."
  type        = string
}

variable "github_owner" {
  type = string
}

variable "github_repo" {
  type = string
}

variable "subject_mode" {
  description = "workflow (decision P2 = yes): trust names the exact workflow file. branch (fallback): any workflow on main."
  type        = string
  default     = "workflow"

  validation {
    condition     = contains(["workflow", "branch"], var.subject_mode)
    error_message = "subject_mode must be workflow or branch (same values as the bootstrap SubjectMode)."
  }
}

variable "allowed_workflows" {
  description = "Workflow files (under .github/workflows) that may assume the deploy role."
  type        = list(string)
}

variable "ecr_repository_arn" {
  type = string
}

variable "promotion_source_repository_arn" {
  description = "prod: ARN of dev's ECR repository, so deploy-prod can pull the image to copy it. Empty in dev."
  type        = string
  default     = ""
}

variable "cluster_arn" {
  type = string
}

variable "service_name" {
  type = string
}

variable "task_definition_family_prefix" {
  description = "RunTask is allowed on task definitions named <prefix>-*."
  type        = string
}

variable "pass_role_arns" {
  description = "The task and execution roles that may be passed to ECS (and nothing else)."
  type        = list(string)
}

variable "web_bucket_arn" {
  type = string
}

variable "releases_bucket_arn" {
  type = string
}

variable "distribution_arn" {
  type = string
}

variable "log_group_arns" {
  description = "Migrate and ops log groups the deploy role may read."
  type        = list(string)
}

variable "db_instance_arn" {
  description = "dev only: lets dev-power stop and start the database. Empty in prod."
  type        = string
  default     = ""
}
