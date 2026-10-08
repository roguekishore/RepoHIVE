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
  aws_account_id    = "123456789012"
  owner_tag         = "owner@example.com"
  site_domain       = "app.repohive.dev"
  account_name      = "prod"
  github_repository = "example/repohive"
}

# The trust policy names the provider by ARN, which is known only after apply.
override_resource {
  target          = aws_iam_openid_connect_provider.github
  override_during = plan
  values          = { arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
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

  # The build workflow derives this name from the account id; only this repository's environment may assume it.
  assert {
    condition = aws_iam_role.github_build.name == "repohive-github-build" && strcontains(
      data.aws_iam_policy_document.github_build_assume.json, "repo:example/repohive:environment:prod"
    )
    error_message = "The GitHub build role's name or trusted subject changed."
  }

  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 1
    error_message = "With no existing provider, the root creates one."
  }

  assert {
    condition     = aws_ecr_repository.indexer.force_delete == false && aws_s3_bucket.ops.force_destroy == false
    error_message = "A protected account must not let a destroy delete the registry or the ops bucket with content."
  }
}

run "unprotected_with_existing_provider" {
  command = plan

  variables {
    protect                  = false
    github_oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  }

  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0
    error_message = "An existing provider must be reused, not created again."
  }

  assert {
    condition     = aws_ecr_repository.indexer.force_delete == true && aws_s3_bucket.ops.force_destroy == true
    error_message = "An unprotected account lets a destroy delete the registry and the ops bucket."
  }
}

run "immutable_subject" {
  command = plan

  variables {
    github_subject_prefix = "repo:example@1/repohive@2"
  }

  # A repository with immutable subjects: the role trusts the id form, not the name form.
  assert {
    condition = strcontains(data.aws_iam_policy_document.github_build_assume.json, "repo:example@1/repohive@2:environment:prod") && !strcontains(
      data.aws_iam_policy_document.github_build_assume.json, "repo:example/repohive:environment"
    )
    error_message = "The role must trust the subject prefix GitHub issues for the repository."
  }
}
