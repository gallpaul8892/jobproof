output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "service_name" {
  value = aws_ecs_service.api.name
}

output "api_task_family" {
  value = aws_ecs_task_definition.api.family
}

output "ops_task_families" {
  description = "Family names of the one-off tasks: db-roles, migrate, create-user and (dev) seed-demo."
  value       = { for key, task in aws_ecs_task_definition.ops : key => task.family }
}

output "task_definition_family_prefix" {
  description = "ecs:RunTask is allowed on <prefix>-*:* only."
  value       = var.name
}

output "app_security_group_id" {
  value = aws_security_group.app.id
}

output "ops_security_group_id" {
  value = aws_security_group.ops.id
}

output "db_client_security_groups" {
  description = "Static keys, unknown values: the rds module's allowed_security_groups."
  value       = local.task_security_groups
}

output "task_role_arns" {
  value = [aws_iam_role.app_task.arn, aws_iam_role.ops_task.arn]
}

output "execution_role_arns" {
  value = [aws_iam_role.app_execution.arn, aws_iam_role.ops_execution.arn]
}

output "log_group_names" {
  description = "api, migrate, ops."
  value = {
    api     = aws_cloudwatch_log_group.api.name
    migrate = aws_cloudwatch_log_group.migrate.name
    ops     = aws_cloudwatch_log_group.ops.name
  }
}

output "log_group_arns" {
  description = "The migrate and ops log groups, which the deploy role may read."
  value       = [aws_cloudwatch_log_group.migrate.arn, aws_cloudwatch_log_group.ops.arn]
}
