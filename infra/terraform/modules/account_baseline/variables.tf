variable "name" {
  type = string
}

variable "account_id" {
  type = string
}

variable "enable_guardduty" {
  description = "Threat detection (decision P7): prod only, about 3 to 5 pounds a month."
  type        = bool
  default     = false
}

variable "cloudtrail_retention_days" {
  type    = number
  default = 400
}

variable "force_destroy" {
  description = "dev only: allow destroying the trail bucket with logs in it."
  type        = bool
  default     = false
}
