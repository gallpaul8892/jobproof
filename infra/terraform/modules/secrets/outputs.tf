output "arns" {
  description = "Secret ARNs by name: jwt-secret, photo-url-secret, db-app-password, db-migrator-password, and demo-password when created."
  value       = { for name, secret in aws_secretsmanager_secret.this : name => secret.arn }
}

output "admin_initial_password_name" {
  description = "Name of the secret Paul creates by hand before running create-user (spec 1F). Not managed by Terraform."
  value       = "jobproof/${var.environment}/admin-initial-password"
}
