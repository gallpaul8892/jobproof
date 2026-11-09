# Everything the workflows (INFRA-5) need to deploy, run one-off tasks and smoke-test.

output "site_url" {
  description = "https://<distribution domain>: the address to open, and the API origin for config.js."
  value       = module.web_static.origin
}

output "distribution_id" {
  value = module.web_static.distribution_id
}

output "web_bucket" {
  value = module.web_static.web_bucket_name
}

output "releases_bucket" {
  value = module.web_static.releases_bucket_name
}

output "photos_bucket" {
  value = module.photos_bucket.bucket_name
}

output "ecr_repository_url" {
  value = module.ecr.repository_url
}

output "ecr_repository_name" {
  value = module.ecr.repository_name
}

output "ecs_cluster" {
  value = module.ecs_service.cluster_name
}

output "ecs_service" {
  value = module.ecs_service.service_name
}

output "api_task_family" {
  value = module.ecs_service.api_task_family
}

output "ops_task_families" {
  description = "db-roles, migrate, create-user and (dev) seed-demo."
  value       = module.ecs_service.ops_task_families
}

output "ops_network" {
  description = "awsvpc settings for `aws ecs run-task` of the one-off tasks."
  value = {
    subnets          = module.network.task_subnet_ids
    security_groups  = [module.ecs_service.ops_security_group_id]
    assign_public_ip = module.network.task_assign_public_ip
  }
}

output "log_groups" {
  description = "api, migrate, ops."
  value       = module.ecs_service.log_group_names
}

output "release_parameter" {
  description = "SSM parameter the pipeline writes after a successful deploy (not managed by Terraform)."
  value       = local.release_param_name
}

output "deploy_role_arn" {
  value = module.ci_roles.deploy_role_arn
}

output "db_instance_identifier" {
  description = "For dev-power (stop and start)."
  value       = module.rds.identifier
}

output "alarm_topic_arn" {
  value = module.monitoring.sns_topic_arn
}

output "demo_password_secret" {
  description = "Dev only: read the demo password here in the console. Empty in prod."
  value       = var.demo_seed_allowed ? "jobproof/${var.environment}/demo-password" : ""
}

output "admin_initial_password_secret" {
  description = "Create this secret by hand before the create-user workflow (spec 1F). Not managed by Terraform."
  value       = module.secrets.admin_initial_password_name
}
