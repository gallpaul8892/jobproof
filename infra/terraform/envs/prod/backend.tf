# Remote state in this account's bootstrap bucket (infra/bootstrap/bootstrap.cfn.yaml), with S3
# native locking (no DynamoDB table). The bucket name contains the account ID, and a backend block
# cannot use variables, so it is supplied at init time:
#
#   terraform init -backend-config="bucket=jobproof-tfstate-<prod account id>"
#
# The workflows do exactly that. Bootstrap must have been uploaded first (spec section 1D).
terraform {
  backend "s3" {
    key          = "jobproof/prod/terraform.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}
