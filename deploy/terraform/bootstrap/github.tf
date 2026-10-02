# The build role for GitHub Actions (.github/workflows/build.yml). The workflow builds the indexer image and the app
# release natively on arm64 and pushes both into this account, with short-lived credentials from GitHub's OIDC
# provider: no AWS key is stored in GitHub. Only a run in this account's GitHub environment (account_name) of this
# repository can assume it, and it can only push to the indexer repository and upload under releases/.

locals {
  github_oidc_url          = "token.actions.githubusercontent.com"
  github_oidc_provider_arn = var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn
}

# An account holds at most one provider per URL; reuse an existing one through github_oidc_provider_arn.
resource "aws_iam_openid_connect_provider" "github" {
  count = var.github_oidc_provider_arn == "" ? 1 : 0

  url            = "https://${local.github_oidc_url}"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_build_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_url}:aud"
      values   = ["sts.amazonaws.com"]
    }

    # A job that names an environment gets this subject; the workflow picks the environment from the tag.
    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_url}:sub"
      values   = ["repo:${var.github_repository}:environment:${var.account_name}"]
    }
  }
}

data "aws_iam_policy_document" "github_build" {
  statement {
    sid       = "RegistryLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PushIndexerImage"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [aws_ecr_repository.indexer.arn]
  }

  statement {
    sid       = "UploadReleases"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.ops.arn}/releases/*"]
  }

  # The account guard of the deploy scripts calls GetCallerIdentity; it needs no permission.
}

resource "aws_iam_role" "github_build" {
  name                 = "repohive-github-build"
  description          = "GitHub Actions build workflow of ${var.github_repository} (environment ${var.account_name})"
  assume_role_policy   = data.aws_iam_policy_document.github_build_assume.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "github_build" {
  name   = "build"
  role   = aws_iam_role.github_build.id
  policy = data.aws_iam_policy_document.github_build.json
}
