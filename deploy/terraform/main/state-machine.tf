# The Step Functions state machine (Requirement 11): Standard, JSONata, written in state-machine.asl.json
# and filled in with templatefile. A test in packages/indexer reads that file and keeps its structure honest.

resource "aws_cloudwatch_log_group" "state_machine" {
  name              = local.log_group_state_machine
  retention_in_days = var.log_retention_days
}

locals {
  ecs_cluster_arn         = "arn:aws:ecs:${local.region}:${local.account_id}:cluster/${local.ecs_cluster}"
  task_definition_pattern = "arn:aws:ecs:${local.region}:${local.account_id}:task-definition/${local.task_family}:*"
  task_pattern            = "arn:aws:ecs:${local.region}:${local.account_id}:task/${local.ecs_cluster}/*"
}

data "aws_iam_policy_document" "states_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

data "aws_iam_policy_document" "state_machine" {
  statement {
    sid     = "InvokeTheTwoFunctions"
    actions = ["lambda:InvokeFunction"]
    resources = [
      aws_lambda_function.indexer.arn,
      aws_lambda_function.control.arn,
    ]
  }

  # ecs:runTask.sync also polls the task and stops it if the execution is aborted.
  statement {
    sid       = "RunTheIndexerTask"
    actions   = ["ecs:RunTask"]
    resources = [local.task_definition_pattern]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [local.ecs_cluster_arn]
    }
  }

  statement {
    sid       = "ManageTasksInTheCluster"
    actions   = ["ecs:StopTask", "ecs:DescribeTasks"]
    resources = [local.task_pattern]
  }

  statement {
    sid       = "ListTasksInTheCluster"
    actions   = ["ecs:ListTasks"]
    resources = ["*"]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [local.ecs_cluster_arn]
    }
  }

  statement {
    sid       = "PassTheTaskRoles"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.task.arn, aws_iam_role.task_execution.arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  # The managed rule that .sync integrations use to learn that a task ended.
  statement {
    sid     = "SyncIntegrationRule"
    actions = ["events:PutTargets", "events:PutRule", "events:DescribeRule"]
    resources = [
      "arn:aws:events:${local.region}:${local.account_id}:rule/StepFunctionsGetEventsForECSTaskRule",
    ]
  }

  # Log delivery actions do not support resource-level permissions.
  statement {
    sid = "WriteExecutionLogs"
    actions = [
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutResourcePolicy",
      "logs:DescribeResourcePolicies",
      "logs:DescribeLogGroups",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role" "state_machine" {
  name               = "repohive-index"
  assume_role_policy = data.aws_iam_policy_document.states_assume.json
}

resource "aws_iam_role_policy" "state_machine" {
  name   = "run"
  role   = aws_iam_role.state_machine.id
  policy = data.aws_iam_policy_document.state_machine.json
}

resource "aws_sfn_state_machine" "index" {
  name     = local.state_machine
  role_arn = aws_iam_role.state_machine.arn
  type     = "STANDARD"

  definition = templatefile("${path.module}/state-machine.asl.json", {
    indexer_function_arn   = aws_lambda_function.indexer.arn
    control_function_arn   = aws_lambda_function.control.arn
    cluster_arn            = aws_ecs_cluster.main.arn
    task_definition_family = local.task_family
    container_name         = local.task_container
    subnet_a               = aws_subnet.public[0].id
    subnet_b               = aws_subnet.public[1].id
    security_group         = aws_security_group.fargate.id
  })

  # Errors only, and never the execution data (it holds job inputs).
  logging_configuration {
    log_destination        = "${aws_cloudwatch_log_group.state_machine.arn}:*"
    include_execution_data = false
    level                  = "ERROR"
  }

  depends_on = [aws_iam_role_policy.state_machine]
}

# An execution that ends FAILED, TIMED_OUT or ABORTED outside its own error handling still leaves a
# terminal ledger state: EventBridge calls failIfOpen with the execution name, which is the job id
# (Requirement 11.8, 11.9).
resource "aws_cloudwatch_event_rule" "execution_ended" {
  name        = "repohive-index-ended"
  description = "repohive-index executions that ended FAILED, TIMED_OUT or ABORTED"

  event_pattern = jsonencode({
    source        = ["aws.states"]
    "detail-type" = ["Step Functions Execution Status Change"]
    detail = {
      status          = ["FAILED", "TIMED_OUT", "ABORTED"]
      stateMachineArn = [aws_sfn_state_machine.index.arn]
    }
  })
}

resource "aws_cloudwatch_event_target" "execution_ended" {
  rule = aws_cloudwatch_event_rule.execution_ended.name
  arn  = aws_lambda_function.control.arn

  input_transformer {
    input_paths = {
      name   = "$.detail.name"
      status = "$.detail.status"
    }
    input_template = "{\"op\":\"failIfOpen\",\"jobId\":\"<name>\",\"code\":\"execution-<status>\"}"
  }
}

resource "aws_lambda_permission" "events_invoke_control" {
  statement_id  = "AllowEventBridgeFailIfOpen"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.control.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.execution_ended.arn
}
