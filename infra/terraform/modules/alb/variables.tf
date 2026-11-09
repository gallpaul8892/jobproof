variable "name" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "vpc_cidr" {
  description = "Egress to the tasks is allowed within the VPC only."
  type        = string
}

variable "subnet_ids" {
  description = "The private app subnets (two zones)."
  type        = list(string)
}

variable "container_port" {
  type    = number
  default = 8000
}

variable "health_check_path" {
  description = "Liveness only: no database check, so a database failover does not make the ALB kill every task."
  type        = string
  default     = "/health/live"
}

variable "deletion_protection" {
  type    = bool
  default = false
}
