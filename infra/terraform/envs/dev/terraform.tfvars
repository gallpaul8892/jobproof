# dev: APP_ENV=staging, about 45 pounds a month always on (spec section 6). No secrets here.
environment = "dev"
app_env     = "staging"

# network: no NAT, tasks in public subnets that admit only the ALB
vpc_cidr           = "10.20.0.0/16"
enable_nat_gateway = false

# compute: 1 task, 0.25 vCPU / 0.5 GB
task_cpu              = 256
task_memory           = 512
desired_count         = 1
autoscaling_max_count = 0
log_retention_days    = 14

# database: db.t4g.micro, single-AZ, 7-day backups, no deletion protection
db_instance_class        = "db.t4g.micro"
db_multi_az              = false
db_backup_retention_days = 7
db_deletion_protection   = false
db_final_snapshot        = false
db_apply_immediately     = true

# secrets and demo data: dev ONLY (the prod tfvars reject demo_seed_allowed)
secret_recovery_window_days = 0
demo_seed_allowed           = true

# edge, security, monitoring: WAF and GuardDuty are prod-only (P6, P7); alarms off except cost
enable_waf       = false
enable_guardduty = false
enable_alarms    = false

# Placeholder on purpose: the monitoring module rejects example.com, so the first plan fails
# until you put your own address here (or pass -var alarm_email=...). Not a secret.
alarm_email = "CHANGE-ME@example.com"

force_destroy_buckets = true

# Peer account for image promotion: set to the PROD account ID once prod is bootstrapped.
promotion_peer_account_id = ""

oidc_subject_mode = "workflow"
deploy_workflows = [
  "pipeline.yml",
  "rollback.yml",
  "create-user.yml",
  "dev-demo-data.yml",
  "dev-power.yml",
]
