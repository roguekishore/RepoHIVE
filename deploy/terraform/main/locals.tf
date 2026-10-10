# Every name this stack fixes or derives from the account id, built once so a role written early can
# name a later resource by ARN without referring to it.
locals {
  region     = "ap-south-1"
  account_id = var.aws_account_id

  default_tags = {
    Project     = "repohive"
    Environment = "prod"
    ManagedBy   = "terraform"
    Owner       = var.owner_tag
    CostCenter  = "repohive-hosted"
  }

  origin_domain = "origin.${var.site_domain}"

  # What the workers call back: the server, through the site domain and CloudFront (/api/internal/**).
  server_url = "https://${var.site_domain}"

  # Buckets
  artifact_bucket = "repohive-artifacts-${local.account_id}"
  ops_bucket      = "repohive-ops-${local.account_id}"
  state_bucket    = "repohive-tfstate-${local.account_id}"

  # Compute. The jobs ledger is the server's SQLite file on the box; no table lives in AWS.
  state_machine    = "repohive-index"
  indexer_function = "repohive-indexer"
  ecs_cluster      = "repohive"
  task_family      = "repohive-indexer"
  task_container   = "indexer"
  ecr_repository   = "repohive/indexer"

  # Parameters (SSM Parameter Store, SecureString)
  parameter_prefix          = "/repohive"
  github_token_parameter    = "/repohive/github-token"
  origin_secret_parameter   = "/repohive/origin-secret"
  internal_secret_parameter = "/repohive/internal-secret"
  admin_token_parameter     = "/repohive/admin-token"

  # ARNs, built from names so no role needs the resource it names to exist first
  artifact_bucket_arn = "arn:aws:s3:::${local.artifact_bucket}"
  ops_bucket_arn      = "arn:aws:s3:::${local.ops_bucket}"
  state_machine_arn   = "arn:aws:states:${local.region}:${local.account_id}:stateMachine:${local.state_machine}"
  parameter_arn_base  = "arn:aws:ssm:${local.region}:${local.account_id}:parameter"

  # Log groups
  log_group_indexer       = "/aws/lambda/${local.indexer_function}"
  log_group_task          = "/repohive/fargate/indexer"
  log_group_state_machine = "/aws/vendedlogs/states/${local.state_machine}"
  log_group_box_server    = "/repohive/box/server"
  log_group_box_caddy     = "/repohive/box/caddy"
  log_group_box_heartbeat = "/repohive/box/heartbeat"
}
