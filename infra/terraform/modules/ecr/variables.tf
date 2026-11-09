variable "name" {
  description = "Repository name."
  type        = string
  default     = "jobproof-backend"
}

variable "keep_images" {
  description = "Number of most recent images kept (older ones expire)."
  type        = number
  default     = 30
}

variable "pull_from_role_arn" {
  description = <<-EOT
    Optional: an IAM role in ANOTHER account that may pull images (dev lets the prod deploy role
    pull, for promotion). The account is trusted, and the policy condition narrows it to this one
    role, so the role does not need to exist when this is applied. Empty (prod): no policy at all.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = var.pull_from_role_arn == "" || can(regex("^arn:aws:iam::[0-9]{12}:role/.+$", var.pull_from_role_arn))
    error_message = "pull_from_role_arn must be empty or the ARN of an IAM role (arn:aws:iam::<12 digits>:role/<name>)."
  }
}
