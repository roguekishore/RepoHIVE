# The control function (Requirement 10.5): the same image digest with a different command, so the state
# machine does ledger operations through the same JobLedger code the job uses. It touches the ledger table
# and nothing else: no bucket, no parameter.

resource "aws_cloudwatch_log_group" "control" {
  name              = local.log_group_control
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "control_ledger" {
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

data "aws_iam_policy_document" "control_logs" {
  statement {
    sid       = "WriteOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.control.arn}:*"]
  }
}

resource "aws_iam_role" "control" {
  name               = "repohive-control"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "control_ledger" {
  name   = "ledger"
  role   = aws_iam_role.control.id
  policy = data.aws_iam_policy_document.control_ledger.json
}

resource "aws_iam_role_policy" "control_logs" {
  name   = "logs"
  role   = aws_iam_role.control.id
  policy = data.aws_iam_policy_document.control_logs.json
}

resource "aws_lambda_function" "control" {
  function_name = local.control_function
  role          = aws_iam_role.control.arn
  package_type  = "Image"
  image_uri     = local.indexer_image
  architectures = ["arm64"]
  memory_size   = 256
  timeout       = 30

  # The image's default command is the job handler; this one is src/control.ts.
  image_config {
    command = ["dist/control.handler"]
  }

  environment {
    variables = {
      REPOHIVE_LEDGER = local.indexer_ledger
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.control.name
  }

  depends_on = [
    aws_cloudwatch_log_group.control,
    aws_iam_role_policy.control_ledger,
    aws_iam_role_policy.control_logs,
  ]
}
