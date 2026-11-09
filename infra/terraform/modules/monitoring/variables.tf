variable "name" {
  type = string
}

variable "alarm_email" {
  description = "Receives alarm and cost-anomaly emails. Confirm the SNS subscription email once (spec INFRA-7)."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alarm_email)) && !endswith(lower(var.alarm_email), "@example.com") && !endswith(lower(var.alarm_email), ".invalid")
    error_message = "alarm_email must be a real email address (the committed placeholder is rejected on purpose)."
  }
}

variable "enable_alarms" {
  description = "false in dev (only cost anomaly detection stays on), true in prod."
  type        = bool
}

variable "alb_arn_suffix" {
  type = string
}

variable "target_group_arn_suffix" {
  type = string
}

variable "db_instance_identifier" {
  type = string
}

variable "min_healthy_tasks" {
  description = "Alarm when fewer healthy targets than this are registered."
  type        = number
  default     = 1
}

variable "db_free_storage_threshold_bytes" {
  description = "Alarm below this much free storage (default 4 GiB of the 20 GB disk)."
  type        = number
  default     = 4294967296
}

variable "db_connections_threshold" {
  description = "db.t4g.micro allows roughly 110 connections; alarm well below that."
  type        = number
  default     = 80
}

variable "cost_anomaly_threshold" {
  description = "Cost Anomaly Detection: email when an anomaly's total impact is at least this many USD (the account billing currency)."
  type        = number
  default     = 10
}
