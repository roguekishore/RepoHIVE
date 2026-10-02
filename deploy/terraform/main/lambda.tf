# The S and M indexer: the indexer image on Lambda, arm64, by digest, using the image's
# default command (the dist/lambda.handler). Outside the VPC; no reserved concurrency (a fresh
# account's low limit may forbid it, and the ledger's global in-flight cap bounds concurrency).

resource "aws_cloudwatch_log_group" "indexer" {
  name              = local.log_group_indexer
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "indexer_logs" {
  statement {
    sid       = "WriteOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.indexer.arn}:*"]
  }
}

resource "aws_iam_role" "indexer" {
  name               = "repohive-indexer"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "indexer_job" {
  name   = "job"
  role   = aws_iam_role.indexer.id
  policy = data.aws_iam_policy_document.indexer_job.json
}

resource "aws_iam_role_policy" "indexer_token" {
  name   = "github-token"
  role   = aws_iam_role.indexer.id
  policy = data.aws_iam_policy_document.read_token_parameter_lambda.json
}

resource "aws_iam_role_policy" "indexer_logs" {
  name   = "logs"
  role   = aws_iam_role.indexer.id
  policy = data.aws_iam_policy_document.indexer_logs.json
}

resource "aws_lambda_function" "indexer" {
  function_name = local.indexer_function
  role          = aws_iam_role.indexer.arn
  package_type  = "Image"
  image_uri     = local.indexer_image
  architectures = ["arm64"]
  memory_size   = var.lambda_memory_mb
  timeout       = var.lambda_timeout_seconds

  ephemeral_storage {
    size = var.lambda_ephemeral_storage_mb
  }

  # The GitHub token is read from SSM by name, never set here. AWS_REGION is
  # set by Lambda itself. The heap stays at the image's NODE_OPTIONS default.
  environment {
    variables = {
      REPOHIVE_RUNTIME                = "lambda"
      REPOHIVE_STORE                  = local.indexer_store
      REPOHIVE_LEDGER                 = local.indexer_ledger
      REPOHIVE_GITHUB_TOKEN_PARAMETER = local.github_token_parameter
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.indexer.name
  }

  depends_on = [
    aws_cloudwatch_log_group.indexer,
    aws_iam_role_policy.indexer_job,
    aws_iam_role_policy.indexer_token,
    aws_iam_role_policy.indexer_logs,
  ]
}
