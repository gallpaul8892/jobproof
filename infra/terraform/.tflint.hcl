# tflint configuration. The bundled terraform ruleset needs no download.
# The AWS ruleset is an optional extra: add it once its current version is checked at
# https://github.com/terraform-linters/tflint-ruleset-aws/releases
#
# plugin "aws" {
#   enabled = true
#   version = "<check the latest release>"
#   source  = "github.com/terraform-linters/tflint-ruleset-aws"
# }

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
