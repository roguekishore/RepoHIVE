# What the Lambda function and the Fargate task share (Requirements 8 and 9): the image reference, the
# environment of the job, and the permissions of the job itself.

locals {
  indexer_image = "${local.account_id}.dkr.ecr.${local.region}.amazonaws.com/${local.ecr_repository}@${var.indexer_image_digest}"

  # The same store and ledger settings on both runtimes (Requirements 8.2 and 9.3).
  indexer_store  = "s3:${local.artifact_bucket}"
  indexer_ledger = "dynamodb:${local.ledger_table}"

  # The V8 heap on Fargate (hosting-2 Requirement 5.2). The Lambda heap stays at the image's default.
  fargate_node_options = "--max-old-space-size=13000"

  # The job's objects live under these prefixes (hosting-2 Requirement 7): snapshots, index files,
  # repository pointers, metadata.
  indexer_object_prefixes = ["s", "idx", "r", "meta"]

  # The SSM-managed key of the account is created on first use, so it is named by pattern and limited to
  # use through SSM (Requirements 8.5 and 9.5).
  kms_key_pattern = "arn:aws:kms:${local.region}:${local.account_id}:key/*"
}

data "aws_iam_policy_document" "indexer_job" {
  statement {
    sid       = "ObjectsOfTheJob"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [for p in local.indexer_object_prefixes : "${local.artifact_bucket_arn}/${p}/*"]
  }

  statement {
    sid       = "ListSnapshotsAndIndexes"
    actions   = ["s3:ListBucket"]
    resources = [local.artifact_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["s/*", "idx/*"]
    }
  }

  statement {
    sid = "Ledger"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
    ]
    resources = [local.ledger_table_arn, "${local.ledger_table_arn}/index/*"]
  }
}

data "aws_iam_policy_document" "read_token_parameter_lambda" {
  statement {
    sid       = "ReadGithubToken"
    actions   = ["ssm:GetParameter"]
    resources = [local.github_token_parameter_arn]
  }

  statement {
    sid       = "DecryptThroughSsm"
    actions   = ["kms:Decrypt"]
    resources = [local.kms_key_pattern]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${local.region}.amazonaws.com"]
    }
  }
}
