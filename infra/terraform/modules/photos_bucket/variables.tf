variable "bucket_name" {
  description = "Globally unique, for example jobproof-dev-photos-<account id>."
  type        = string
}

variable "noncurrent_version_days" {
  type    = number
  default = 30
}

variable "force_destroy" {
  description = "true only in dev (lets a destroy remove a bucket that still holds objects). Always false in prod."
  type        = bool
  default     = false
}
