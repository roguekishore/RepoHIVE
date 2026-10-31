# The laptop side of the unified deploy (DEPLOY-SPEC.md section 11): the IAM user `./ops` runs as, and the only two
# commands it can run on the box. Its access key is made by hand in the console and kept in ~/.ops/repohive.csv, so
# the secret never enters state. The deploy role itself is in the bootstrap root (github.tf).

locals {
  # Every unit of every role the box runs, in deploy/ops.env's order.
  ops_services      = ["repohive-env.service", "caddy.service", "repohive-web.service", "repohive-server.service"]
  ops_instance_arns = "arn:aws:ec2:${local.region}:${local.account_id}:instance/*"
}

resource "aws_iam_user" "ops" {
  name = "repohive-ops"
}

data "aws_iam_policy_document" "ops" {
  statement {
    sid     = "ReadReleaseAndInstances"
    actions = ["ssm:GetParameter"]
    resources = [
      "${local.parameter_arn_base}/repohive/release",
      "${local.parameter_arn_base}/repohive/instances",
    ]
  }

  statement {
    sid       = "SessionOnTheBox"
    actions   = ["ssm:StartSession"]
    resources = [local.ops_instance_arns]

    condition {
      test     = "StringLike"
      variable = "ssm:resourceTag/deploy-repohive"
      values   = ["*"]
    }
  }

  statement {
    sid     = "SessionDocuments"
    actions = ["ssm:StartSession"]
    resources = [
      "arn:aws:ssm:${local.region}:${local.account_id}:document/SSM-SessionManagerRunShell",
      "arn:aws:ssm:${local.region}::document/AWS-StartInteractiveCommand",
    ]
  }

  statement {
    sid       = "OwnSessions"
    actions   = ["ssm:TerminateSession", "ssm:ResumeSession"]
    resources = ["arn:aws:ssm:*:*:session/$${aws:username}-*"]
  }

  statement {
    sid       = "LogsAndStatusDocuments"
    actions   = ["ssm:SendCommand"]
    resources = [aws_ssm_document.ops_logs.arn, aws_ssm_document.ops_status.arn]
  }

  statement {
    sid       = "LogsAndStatusOnTheBox"
    actions   = ["ssm:SendCommand"]
    resources = [local.ops_instance_arns]

    condition {
      test     = "StringLike"
      variable = "ssm:resourceTag/deploy-repohive"
      values   = ["*"]
    }
  }

  # No resource-level support for these.
  statement {
    sid       = "WatchCommands"
    actions   = ["ssm:GetCommandInvocation", "ssm:DescribeInstanceInformation"]
    resources = ["*"]
  }

  statement {
    sid       = "ListReleases"
    actions   = ["s3:ListBucket"]
    resources = [local.deploy_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["releases/*"]
    }
  }
}

resource "aws_iam_user_policy" "ops" {
  name   = "ops"
  user   = aws_iam_user.ops.name
  policy = data.aws_iam_policy_document.ops.json
}

resource "aws_ssm_document" "ops_logs" {
  name            = "repohive-logs"
  document_type   = "Command"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "repohive: the last N lines of the box services' journal"
    parameters = {
      lines = {
        type           = "String"
        default        = "200"
        allowedPattern = "^[0-9]{1,4}$"
      }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "logs"
      inputs = {
        runCommand = ["journalctl --no-pager -n {{lines}} ${join(" ", [for s in local.ops_services : "-u ${s}"])}"]
      }
    }]
  })
}

resource "aws_ssm_document" "ops_status" {
  name            = "repohive-status"
  document_type   = "Command"
  document_format = "JSON"

  content = jsonencode({
    schemaVersion = "2.2"
    description   = "repohive: current release, service state, health"
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "status"
      inputs = {
        runCommand = [
          "echo \"current: $(readlink -e /opt/repohive/current || echo none)\"",
          "for s in ${join(" ", local.ops_services)}; do echo \"$s: $(systemctl is-active $s)\"; done",
          "if curl -fsS --max-time 2 http://127.0.0.1:3001/healthz | grep -Eq '\"status\": ?\"ok\"'; then echo 'health: ok'; else echo 'health: FAILING'; fi",
        ]
      }
    }]
  })
}

# name=instance-id pairs for `./ops shell`.
resource "aws_ssm_parameter" "instances" {
  name  = "/repohive/instances"
  type  = "String"
  value = "box=${aws_instance.box.id}"
}
