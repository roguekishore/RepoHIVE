# The L and XL indexer (Requirement 9): the same image on Fargate, started only by the state machine.
# The entry point is set here because the base image's /lambda-entrypoint.sh would start the runtime
# interface emulator outside Lambda (packages/indexer/DEPLOY.md).

resource "aws_ecs_cluster" "main" {
  name = local.ecs_cluster

  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_cloudwatch_log_group" "task" {
  name              = local.log_group_task
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# The task role: what the job does (Requirement 9.5), without the SSM permissions: ECS injects the token.
resource "aws_iam_role" "task" {
  name               = "repohive-indexer-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "task_job" {
  name   = "job"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.indexer_job.json
}

# The execution role: pulls the image, writes logs, and reads the token parameter for the task's secrets.
data "aws_iam_policy_document" "execution_token" {
  statement {
    sid       = "ReadGithubToken"
    actions   = ["ssm:GetParameters"]
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

resource "aws_iam_role" "task_execution" {
  name               = "repohive-indexer-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_token" {
  name   = "github-token"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.execution_token.json
}

resource "aws_ecs_task_definition" "indexer" {
  family                   = local.task_family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.fargate_cpu_units
  memory                   = var.fargate_memory_mb
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name             = local.task_container
      image            = local.indexer_image
      essential        = true
      entryPoint       = ["node"]
      command          = ["dist/fargate.js"]
      workingDirectory = "/var/task"

      environment = [
        { name = "REPOHIVE_RUNTIME", value = "fargate" },
        { name = "REPOHIVE_STORE", value = local.indexer_store },
        { name = "REPOHIVE_LEDGER", value = local.indexer_ledger },
        { name = "AWS_REGION", value = local.region },
        { name = "NODE_OPTIONS", value = local.fargate_node_options },
      ]

      # Injected by ECS from the SSM parameter; the value is never in this definition.
      secrets = [
        { name = "REPOHIVE_GITHUB_TOKEN", valueFrom = local.github_token_parameter_arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.task.name
          "awslogs-region"        = local.region
          "awslogs-stream-prefix" = "indexer"
        }
      }
    }
  ])

  depends_on = [aws_iam_role_policy.task_execution_token]
}
