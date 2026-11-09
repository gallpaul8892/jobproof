variable "name" {
  description = "Name prefix, for example jobproof-dev."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR of the VPC (a /16). dev 10.20.0.0/16, prod 10.30.0.0/16."
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && endswith(var.vpc_cidr, "/16")
    error_message = "vpc_cidr must be a valid /16 CIDR block."
  }
}

variable "az_count" {
  description = "Number of availability zones (2 in both environments)."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "az_count must be 2 or 3 (RDS and the ALB each need at least two zones)."
  }
}

variable "enable_nat_gateway" {
  description = <<-EOT
    false (dev): no NAT, tasks run in the public subnets with a public IP and a security group
    that lets in only the ALB. true (prod): tasks run in the private app subnets behind ONE NAT
    gateway (a single-zone dependency for outbound calls, accepted in the spec, risk 5).
  EOT
  type        = bool
}
