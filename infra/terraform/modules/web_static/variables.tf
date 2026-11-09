variable "name" {
  description = "Name prefix, for example jobproof-dev."
  type        = string
}

variable "web_bucket_name" {
  description = "Globally unique, for example jobproof-dev-web-<account id>."
  type        = string
}

variable "releases_bucket_name" {
  description = "Globally unique, for example jobproof-dev-releases-<account id>."
  type        = string
}

variable "alb_arn" {
  description = "The internal ALB the VPC origin points at."
  type        = string
}

variable "alb_dns_name" {
  type = string
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}

variable "web_acl_arn" {
  description = "WAF web ACL (prod, created in us-east-1). null: none."
  type        = string
  default     = null
}

variable "releases_expire_days" {
  type    = number
  default = 180
}

variable "force_destroy" {
  description = "dev only: allow destroying buckets that still hold objects."
  type        = bool
  default     = false
}
