# Production only. Terraform's `prevent_destroy` cannot be set from a variable, so the modules
# cannot carry it for the database and the photos bucket. This resource carries it instead: any
# plan that would destroy it (`terraform destroy`, or removing this file) fails with an error, so
# prod cannot be torn down by accident. AWS-level protection stays on as well: RDS deletion
# protection and a final snapshot, ALB deletion protection, non-empty S3 buckets that cannot be
# deleted (force_destroy = false).
#
# To retire prod on purpose: set the protections off in terraform.tfvars, apply, delete this file,
# then destroy.
resource "terraform_data" "prod_destroy_guard" {
  input = {
    database      = module.rds.identifier
    photos_bucket = module.photos_bucket.bucket_name
  }

  lifecycle {
    prevent_destroy = true
  }
}
