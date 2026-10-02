# An offline plan of the bootstrap root (no AWS account, no credentials): the real AWS provider plans every
# resource. Run with deploy/scripts/check.sh or:
#
#   terraform -chdir=deploy/terraform/bootstrap init -backend=false
#   terraform -chdir=deploy/terraform/bootstrap test

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
  aws_account_id = "123456789012"
  owner_tag      = "owner@example.com"
  site_domain    = "app.repohive.dev"
}

run "plan" {
  command = plan

  # The main root's locals derive the same two bucket names; they must agree.
  assert {
    condition     = aws_s3_bucket.state.bucket == "repohive-tfstate-123456789012" && aws_s3_bucket.ops.bucket == "repohive-ops-123456789012"
    error_message = "The bootstrap bucket names no longer match the main root's locals."
  }

  assert {
    condition     = aws_ecr_repository.indexer.name == "repohive/indexer"
    error_message = "The ECR repository name no longer matches the main root and push-indexer-image.sh."
  }
}
