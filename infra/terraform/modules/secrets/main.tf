# Generated application secrets (spec section 3, `secrets`).
#
# No secret value reaches Terraform state or git:
#   * `ephemeral "random_password"` (random provider >= 3.7.0) exists only in memory during a
#     plan or apply;
#   * it feeds `secret_string_wo`, a WRITE-ONLY argument of aws_secretsmanager_secret_version
#     (Terraform >= 1.11), which is sent to AWS and never stored in plan or state;
#   * `secret_string_wo_version` is what Terraform tracks. Raise it (var.secret_versions) to rotate.
# Encryption uses the AWS-managed key aws/secretsmanager (no custom KMS key).
#
# NOT created here: the RDS master secret (RDS manages it) and admin-initial-password (Paul
# creates it by hand, spec 1F, and the create-user workflow deletes it).

locals {
  generated = merge(
    {
      "jwt-secret"           = 64
      "photo-url-secret"     = 64
      "db-app-password"      = 40
      "db-migrator-password" = 40
    },
    var.create_demo_password ? { "demo-password" = 24 } : {},
  )
  descriptions = {
    "jwt-secret"           = "JWT signing secret (JWT_SECRET)"
    "photo-url-secret"     = "Photo URL signing secret (PHOTO_URL_SECRET)"
    "db-app-password"      = "Password of the jobproof_app database role (DB_PASSWORD for the API)"
    "db-migrator-password" = "Password of the jobproof_migrator database role (migrate, seed-demo)"
    "demo-password"        = "Password of every demo login in dev (DEMO_PASSWORD). Read it in the console, copy it nowhere else"
  }
}

# Letters and digits only: safe in URLs, SQL literals and shells. 40 characters is about 238 bits.
ephemeral "random_password" "this" {
  for_each = local.generated

  length  = each.value
  special = false
}

resource "aws_secretsmanager_secret" "this" {
  for_each = local.generated

  name                    = "jobproof/${var.environment}/${each.key}"
  description             = local.descriptions[each.key]
  recovery_window_in_days = var.recovery_window_in_days
}

resource "aws_secretsmanager_secret_version" "this" {
  for_each = local.generated

  secret_id                = aws_secretsmanager_secret.this[each.key].id
  secret_string_wo         = ephemeral.random_password.this[each.key].result
  secret_string_wo_version = lookup(var.secret_versions, each.key, 1)
}
