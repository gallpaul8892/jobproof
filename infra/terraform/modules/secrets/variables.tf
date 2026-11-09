variable "environment" {
  description = "dev or prod. Secret names are jobproof/<environment>/<name>."
  type        = string
}

variable "create_demo_password" {
  description = "Create jobproof/<environment>/demo-password (dev only; prod has no demo secret)."
  type        = bool
  default     = false
}

variable "recovery_window_in_days" {
  description = "0 deletes at once (dev: a destroy and rebuild can reuse the names). 7 to 30 in prod."
  type        = number

  validation {
    condition     = var.recovery_window_in_days == 0 || (var.recovery_window_in_days >= 7 && var.recovery_window_in_days <= 30)
    error_message = "recovery_window_in_days must be 0 or between 7 and 30."
  }
}

variable "secret_versions" {
  description = <<-EOT
    Write-only arguments are not stored in state, so Terraform cannot see a change. To rotate a
    generated secret, raise its number here (keys: jwt-secret, photo-url-secret, db-app-password,
    db-migrator-password, demo-password). A missing key means 1. After rotating a db-* password,
    re-run the db-roles task (it sets the role password from the secret), then redeploy.
  EOT
  type        = map(number)
  default     = {}
}
