# The deploy role for GitHub Actions (.github/workflows/deploy.yml, the unified deploy: DEPLOY-SPEC.md section 11).
# The workflow builds the indexer image and the app release natively on arm64, pushes the image to ECR and the release
# to the deploy bucket, checks the release against the image the live Lambda runs, and activates it on the box over
# SSM, with short-lived credentials from GitHub's OIDC provider: no AWS key is stored in GitHub. Only a run on this
# repository's `deploy` branch can assume it. It can change neither Lambda nor ECS: `deploy.sh infra` does that.

locals {
  github_oidc_url          = "token.actions.githubusercontent.com"
  github_oidc_provider_arn = var.github_oidc_provider_arn != "" ? var.github_oidc_provider_arn : aws_iam_openid_connect_provider.github[0].arn
  # A repository with immutable subjects puts the owner and repository ids in the subject (repo:owner@id/repo@id).
  github_subject_prefix = var.github_subject_prefix != "" ? var.github_subject_prefix : "repo:${var.github_repository}"
}

# An account holds at most one provider per URL; reuse an existing one through github_oidc_provider_arn.
resource "aws_iam_openid_connect_provider" "github" {
  count = var.github_oidc_provider_arn == "" ? 1 : 0

  url            = "https://${local.github_oidc_url}"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "github_deploy_assume" {
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

    # A job on a branch gets ref:refs/heads/<branch>; only `./ops ship`'s branch may deploy.
    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_url}:sub"
      values   = ["${local.github_subject_prefix}:ref:refs/heads/deploy"]
    }
  }
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid       = "RegistryLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Push (build.sh) and pull (precheck.sh pulls the image the live Lambda runs).
  statement {
    sid = "PushAndPullIndexerImage"
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

  # precheck.sh reads which image the live function runs. Read only.
  statement {
    sid       = "ReadIndexerFunction"
    actions   = ["lambda:GetFunction"]
    resources = ["arn:aws:lambda:${local.region}:${var.aws_account_id}:function:repohive-indexer"]
  }

  statement {
    sid       = "Releases"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.deploy.arn}/releases/*"]
  }

  statement {
    sid       = "ListReleases"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.deploy.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["releases/*"]
    }
  }

  statement {
    sid       = "RunShellScriptDocument"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ssm:${local.region}::document/AWS-RunShellScript"]
  }

  statement {
    sid       = "RunOnTheBox"
    actions   = ["ssm:SendCommand"]
    resources = ["arn:aws:ec2:${local.region}:${var.aws_account_id}:instance/*"]

    condition {
      test     = "StringEquals"
      variable = "ssm:resourceTag/deploy-repohive"
      values   = ["true"]
    }
  }

  # No resource-level support for these.
  statement {
    sid       = "WatchCommands"
    actions   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations", "ssm:DescribeInstanceInformation"]
    resources = ["*"]
  }

  statement {
    sid       = "LiveRelease"
    actions   = ["ssm:GetParameter", "ssm:PutParameter"]
    resources = ["arn:aws:ssm:${local.region}:${var.aws_account_id}:parameter/repohive/release"]
  }

  # The account guard of the deploy scripts calls GetCallerIdentity; it needs no permission.
}

resource "aws_iam_role" "github_deploy" {
  name                 = "repohive-github-deploy"
  description          = "GitHub Actions deploy workflow of ${var.github_repository} (deploy branch)"
  assume_role_policy   = data.aws_iam_policy_document.github_deploy_assume.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
