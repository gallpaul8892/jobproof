# prod: APP_ENV=production. Smallest size first (decision P3, about 70 pounds a month); switch on
# the resilient size (about 135) before real customer data arrives: see the block at the bottom.
# No secrets here.
environment = "prod"
app_env     = "production"

# network: one NAT gateway, tasks in private subnets
vpc_cidr           = "10.30.0.0/16"
enable_nat_gateway = true

# compute: 1 task, 0.25 vCPU / 0.5 GB
task_cpu                = 256
task_memory             = 512
desired_count           = 1
autoscaling_max_count   = 0
log_retention_days      = 90
alb_deletion_protection = true

# database: db.t4g.micro single-AZ at first, 14-day backups, deletion protection, final snapshot
db_instance_class        = "db.t4g.micro"
db_multi_az              = false
db_backup_retention_days = 14
db_deletion_protection   = true
db_final_snapshot        = true
db_apply_immediately     = false

# secrets: NO demo data in prod. Setting demo_seed_allowed = true here is rejected by variable
# validation (and by the backend). The line is deliberately not present.
secret_recovery_window_days = 30

# edge, security, monitoring
enable_waf             = true
waf_managed_rules_mode = "count" # switch to "block" after reading the sampled requests
enable_guardduty       = true
enable_alarms          = true

# Placeholder on purpose: the monitoring module rejects example.com, so the first plan fails
# until you put your own address here (or pass -var alarm_email=...). Not a secret.
alarm_email = "CHANGE-ME@example.com"

force_destroy_buckets = false

# Peer account for image promotion: set to the DEV account ID once dev is bootstrapped. Prod pulls
# the image from dev's ECR by digest (deploy-prod.yml).
promotion_peer_account_id = ""

# Numeric GitHub IDs for the OIDC trust (same values as the bootstrap stack parameters
# GitHubOwnerId and GitHubRepoId). Placeholders on purpose: variable validation rejects them
# until you replace them with the digits from
#   gh api users/gallpaul8892 --jq .id
#   gh api repos/gallpaul8892/jobproof --jq .id
# Not secret.
github_owner_id = "REPLACE-WITH-NUMERIC-OWNER-ID"
github_repo_id  = "REPLACE-WITH-NUMERIC-REPO-ID"

oidc_subject_mode = "workflow"
deploy_workflows = [
  "deploy-prod.yml",
  "rollback.yml",
  "create-user.yml",
]

# ---- resilient size (P3, before go-live): uncomment, then run the pipeline -----------------------
# db_instance_class     = "db.t4g.small"
# db_multi_az           = true
# task_cpu              = 512
# task_memory           = 1024
# desired_count         = 2
# autoscaling_max_count = 4
