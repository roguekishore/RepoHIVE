# Every name this stack fixes or derives from the account id, built once so a role written early can
# name a later resource by ARN without referring to it (hosting-4 "Order of work").
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

  # Buckets
  artifact_bucket = "repohive-artifacts-${local.account_id}"
  ops_bucket      = "repohive-ops-${local.account_id}"
  state_bucket    = "repohive-tfstate-${local.account_id}"

  # Data and compute
  ledger_table     = "repohive-ledger"
  state_machine    = "repohive-index"
  indexer_function = "repohive-indexer"
  control_function = "repohive-control"
  ecs_cluster      = "repohive"
  task_family      = "repohive-indexer"
  task_container   = "indexer"
  ecr_repository   = "repohive/indexer"

  # Parameters (SSM Parameter Store, SecureString)
  parameter_prefix        = "/repohive"
  github_token_parameter  = "/repohive/github-token"
  origin_secret_parameter = "/repohive/origin-secret"

  # ARNs, built from names so no role needs the resource it names to exist first
  artifact_bucket_arn = "arn:aws:s3:::${local.artifact_bucket}"
  ops_bucket_arn      = "arn:aws:s3:::${local.ops_bucket}"
  ledger_table_arn    = "arn:aws:dynamodb:${local.region}:${local.account_id}:table/${local.ledger_table}"
  state_machine_arn   = "arn:aws:states:${local.region}:${local.account_id}:stateMachine:${local.state_machine}"
  parameter_arn_base  = "arn:aws:ssm:${local.region}:${local.account_id}:parameter"

  # Log groups
  log_group_indexer       = "/aws/lambda/${local.indexer_function}"
  log_group_control       = "/aws/lambda/${local.control_function}"
  log_group_task          = "/repohive/fargate/indexer"
  log_group_state_machine = "/aws/vendedlogs/states/${local.state_machine}"
  log_group_box_web       = "/repohive/box/web"
  log_group_box_worker    = "/repohive/box/worker"
  log_group_box_caddy     = "/repohive/box/caddy"
  log_group_box_heartbeat = "/repohive/box/heartbeat"
}
