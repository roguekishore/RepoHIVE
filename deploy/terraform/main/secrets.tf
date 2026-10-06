# Secrets live in SSM Parameter Store as SecureString parameters (standard tier, the aws/ssm key, no
# charge) under /repohive/. Secrets Manager is not used.

locals {
  parameter_arn_prefix = "${local.parameter_arn_base}${local.parameter_prefix}"

  # The owner creates this parameter with deploy/scripts/put-github-token.sh. Terraform only knows its
  # name: no data source, variable, tfvars entry or output carries the token.
  github_token_parameter_arn = "${local.parameter_arn_base}${local.github_token_parameter}"
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
