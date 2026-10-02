# An offline plan of the whole main root (no AWS account, no credentials). The real AWS provider plans every
# resource, so policy documents, templates, the state machine definition and cloud-init are rendered for real;
# only the six data sources that would call AWS are given fixed values. Run with deploy/scripts/check.sh or:
#
#   terraform -chdir=deploy/terraform/main init -backend=false
#   terraform -chdir=deploy/terraform/main test
#
# This proves the configuration renders and holds the cross-file contracts asserted below. It does not prove
# that AWS accepts it: argument validation that happens server-side (the state machine's JSONata, CloudFront)
# is only checked by the first real apply.

provider "aws" {
  region                      = "ap-south-1"
  access_key                  = "offline-plan"
  secret_key                  = "offline-plan"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
}

provider "aws" {
  alias                       = "us_east_1"
  region                      = "us-east-1"
  access_key                  = "offline-plan"
  secret_key                  = "offline-plan"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
}

variables {
  aws_account_id       = "123456789012"
  owner_tag            = "owner@example.com"
  site_domain          = "app.repohive.dev"
  alert_email          = "owner@example.com"
  indexer_image_digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
}

override_data {
  target = data.aws_availability_zones.available
  values = { names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"] }
}

override_data {
  target = data.aws_ec2_managed_prefix_list.cloudfront_origin
  values = { id = "pl-0123456789abcdef0" }
}

override_data {
  target = data.aws_ssm_parameter.al2023_arm64
  values = { insecure_value = "ami-0123456789abcdef0" }
}

override_data {
  target = data.aws_acm_certificate.site
  values = { arn = "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000" }
}

override_data {
  target = data.aws_cloudfront_cache_policy.caching_optimized
  values = { id = "658327ea-f89d-4fab-a63d-7e88639e58f6" }
}

override_data {
  target = data.aws_cloudfront_cache_policy.caching_disabled
  values = { id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" }
}

override_data {
  target = data.aws_cloudfront_origin_request_policy.all_viewer_except_host
  values = { id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" }
}

# The state machine definition names these resources by ARN or id; giving them values at plan time lets the
# test read the rendered definition.
override_resource {
  target          = aws_lambda_function.indexer
  override_during = plan
  values          = { arn = "arn:aws:lambda:ap-south-1:123456789012:function:repohive-indexer" }
}

override_resource {
  target          = aws_lambda_function.control
  override_during = plan
  values          = { arn = "arn:aws:lambda:ap-south-1:123456789012:function:repohive-control" }
}

override_resource {
  target          = aws_ecs_cluster.main
  override_during = plan
  values          = { arn = "arn:aws:ecs:ap-south-1:123456789012:cluster/repohive" }
}

override_resource {
  target          = aws_subnet.public
  override_during = plan
  values          = { id = "subnet-0123456789abcdef0" }
}

override_resource {
  target          = aws_ebs_volume.data
  override_during = plan
  values          = { id = "vol-0123456789abcdef0" }
}

override_resource {
  target          = aws_security_group.fargate
  override_during = plan
  values          = { id = "sg-0123456789abcdef0" }
}

# The provider validates the definition at plan time by calling ValidateStateMachineDefinition, which needs
# credentials. Offline, the resource is overridden so its configured definition is kept but not sent; the first
# real plan is where AWS checks the JSONata.
override_resource {
  target          = aws_sfn_state_machine.index
  override_during = plan
  values          = { arn = "arn:aws:states:ap-south-1:123456789012:stateMachine:repohive-index" }
}

run "plan" {
  command = plan

  # EC2 refuses user data over 16 KB (before base64).
  assert {
    condition     = length(local.box_user_data) < 16384
    error_message = "The box's user data is ${length(local.box_user_data)} bytes, over EC2's 16 KB limit."
  }

  # The rendered state machine is valid JSON with no placeholder left unfilled.
  assert {
    condition     = can(jsondecode(aws_sfn_state_machine.index.definition)) && !strcontains(aws_sfn_state_machine.index.definition, "$${")
    error_message = "The state machine definition is not valid JSON or still holds a $${...} placeholder."
  }

  # A GetObject on a missing key answers 404 only to a caller allowed s3:ListBucket on the whole bucket; with
  # a prefix condition it is 403, and the store reads that as an error. First-time pre-checks read missing keys.
  assert {
    condition = alltrue([
      for doc in [data.aws_iam_policy_document.indexer_job.json, data.aws_iam_policy_document.box.json] :
      anytrue([
        for s in jsondecode(doc).Statement :
        s.Effect == "Allow" && contains(flatten([s.Action]), "s3:ListBucket") && !can(s.Condition)
      ])
    ])
    error_message = "The indexer and box roles need s3:ListBucket on the artifact bucket without a prefix condition."
  }

  # The box's worker reads snapshot manifests and views under s/ (hosting-3 worker tick).
  assert {
    condition = anytrue([
      for s in jsondecode(data.aws_iam_policy_document.box.json).Statement :
      contains(flatten([s.Action]), "s3:GetObject") && contains(flatten([s.Resource]), "arn:aws:s3:::repohive-artifacts-123456789012/s/*")
    ])
    error_message = "The box role cannot read snapshot objects under s/."
  }

  assert {
    condition     = aws_instance.box.disable_api_termination == true && aws_dynamodb_table.ledger.deletion_protection_enabled == true && aws_s3_bucket.artifacts.force_destroy == false
    error_message = "A protected account must keep termination and deletion protection on."
  }
}

run "unprotected" {
  command = plan

  variables {
    protect = false
  }

  assert {
    condition     = aws_instance.box.disable_api_termination == false && aws_dynamodb_table.ledger.deletion_protection_enabled == false && aws_s3_bucket.artifacts.force_destroy == true
    error_message = "An unprotected account must let a destroy remove the box, the table and the artifact bucket."
  }
}
