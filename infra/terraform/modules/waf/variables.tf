variable "name" {
  type = string
}

variable "login_rate_limit" {
  description = "Requests per evaluation window per IP to POST /api/v1/auth/login before blocking (spec: for example 100 per 5 minutes)."
  type        = number
  default     = 100

  validation {
    condition     = var.login_rate_limit >= 10
    error_message = "WAF rate-based rules need a limit of at least 10."
  }
}

variable "managed_rules_mode" {
  description = "count (observe first, the spec default) or block for the AWS managed common rule set."
  type        = string
  default     = "count"

  validation {
    condition     = contains(["count", "block"], var.managed_rules_mode)
    error_message = "managed_rules_mode must be count or block."
  }
}
