# What the Lambda function and the Fargate task share: the image reference, the
# environment of the job, and the permissions of the job itself.

locals {
  indexer_image = "${local.account_id}.dkr.ecr.${local.region}.amazonaws.com/${local.ecr_repository}@${var.indexer_image_digest}"

  # The same store on both runtimes. Progress and the outcome go to the server, not to a table.
  indexer_store = "s3:${local.artifact_bucket}"

  # The V8 heap on Fargate. The Lambda heap stays at the image's default.
  fargate_node_options = "--max-old-space-size=13000"

  # The job's objects live under these prefixes: public snapshots under artifacts/
  # (the only prefix CloudFront serves) and the compact index and pruning record under private/.
  indexer_object_prefixes = ["artifacts", "private"]

  # The SSM-managed key of the account is created on first use, so it is named by pattern and limited to
  # use through SSM.
  kms_key_pattern = "arn:aws:kms:${local.region}:${local.account_id}:key/*"
}

data "aws_iam_policy_document" "indexer_job" {
  statement {
    sid       = "ObjectsOfTheJob"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = [for p in local.indexer_object_prefixes : "${local.artifact_bucket_arn}/${p}/*"]
  }

  # Bucket-wide on purpose. S3 answers a GetObject on a missing key with 404 only to a caller allowed
  # s3:ListBucket on the bucket; under an s3:prefix condition the answer is 403, which the store reads as an
  # error. Publish reads private/<owner>/<repo>/history.json, missing on a repository's first index. It reveals
  # key names only, never object contents.
  statement {
    sid       = "ListArtifactBucket"
    actions   = ["s3:ListBucket"]
    resources = [local.artifact_bucket_arn]
  }
}

data "aws_iam_policy_document" "read_token_parameter_lambda" {
  statement {
    sid       = "ReadGithubTokenAndInternalSecret"
    actions   = ["ssm:GetParameter"]
    resources = [local.github_token_parameter_arn, local.internal_secret_parameter_arn]
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

# The Fargate task reads the internal secret itself when a run starts; ECS injects the GitHub token through the
# execution role, so the task role names this one parameter only.
data "aws_iam_policy_document" "read_internal_secret_task" {
  statement {
    sid       = "ReadInternalSecret"
    actions   = ["ssm:GetParameter"]
    resources = [local.internal_secret_parameter_arn]
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
