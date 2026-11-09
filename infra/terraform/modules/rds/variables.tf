variable "name" {
  description = "Name prefix, for example jobproof-dev."
  type        = string
}

variable "vpc_id" {
  type = string
}

variable "db_subnet_ids" {
  type = list(string)
}

variable "allowed_security_groups" {
  description = "Security groups that may connect on 5432, as a map with fixed keys (app, ops) so for_each works while the IDs are unknown."
  type        = map(string)
}

variable "engine_version" {
  description = "Major version only: AWS picks the latest minor and auto minor upgrades keep it current (spec: 16, standard support to 2029-02-28)."
  type        = string
  default     = "16"
}

variable "instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "allocated_storage_gb" {
  type    = number
  default = 20
}

variable "max_allocated_storage_gb" {
  description = "Storage autoscaling ceiling. 0 turns autoscaling off."
  type        = number
  default     = 100
}

variable "backup_retention_days" {
  description = "Automated backups with point-in-time restore: 7 in dev, 14 in prod (spec 5.3)."
  type        = number

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 1 and 35 (0 would switch backups off)."
  }
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "final_snapshot" {
  description = "Take a final snapshot when the instance is deleted (prod)."
  type        = bool
  default     = false
}

variable "database_name" {
  type    = string
  default = "jobproof"
}

variable "master_username" {
  description = "RDS master user. Used only by the db-roles task (spec 5.4)."
  type        = string
  default     = "jobproof_master"
}

variable "backup_window" {
  description = "UTC. Must not overlap maintenance_window."
  type        = string
  default     = "01:30-02:30"
}

variable "maintenance_window" {
  description = "UTC. Sunday 03:00 (UK time in winter, 04:00 in summer)."
  type        = string
  default     = "sun:03:00-sun:04:00"
}

variable "apply_immediately" {
  description = "Apply modifications at once instead of in the maintenance window. dev true, prod false."
  type        = bool
  default     = false
}
