# Secrets live in SSM Parameter Store as SecureString parameters (standard tier, the aws/ssm key, no
# charge) under /repohive/. Secrets Manager is not used.

locals {
  parameter_arn_prefix = "${local.parameter_arn_base}${local.parameter_prefix}"

  # The owner creates this parameter with deploy/scripts/put-github-token.sh. Terraform only knows its
  # name: no data source, variable, tfvars entry or output carries the token.
  github_token_parameter_arn = "${local.parameter_arn_base}${local.github_token_parameter}"

  internal_secret_parameter_arn = "${local.parameter_arn_base}${local.internal_secret_parameter}"
}

# CloudFront sends this in a custom header and Caddy requires it. It is therefore
# in the Terraform state, which is private and encrypted; the runbook says so and gives the rotation.
resource "random_password" "origin_secret" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "origin_secret" {
  name        = local.origin_secret_parameter
  description = "Header value CloudFront sends to the box; Caddy rejects requests without it"
  type        = "SecureString"
  tier        = "Standard"
  value       = random_password.origin_secret.result
}

# The bearer secret of the workers' calls to the server (/api/internal/**). The server reads it at start-up and
# the Lambda function and the Fargate task read it by name when a run starts. It is in the Terraform state for the
# same reason as the origin secret; rotation is in the runbook.
resource "random_password" "internal_secret" {
  length  = 48
  special = false
}

resource "aws_ssm_parameter" "internal_secret" {
  name        = local.internal_secret_parameter
  description = "Bearer secret of the workers' calls to the server (/api/internal/**)"
  type        = "SecureString"
  tier        = "Standard"
  value       = random_password.internal_secret.result
}

# /repohive/admin-token is not here on purpose. It is the only thing between the internet and the limits page
# (/api/admin/**), so the owner stores it with deploy/scripts/put-admin-token.sh and no state or output holds it.
# Until it exists the box leaves the admin API off (the server answers 404 for it).
