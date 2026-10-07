# The app box: one t4g.small that runs Caddy, the Next.js server and the background worker.
# No key pair and no SSH: shell access is SSM Session Manager. SQLite data lives on its own volume, which
# survives the instance. What runs on it is shipped as a release bundle, not by Terraform.

locals {
  box_files = "${path.module}/../../box"

  box_user_data = templatefile("${local.box_files}/cloud-init.yaml.tftpl", {
    region                         = local.region
    site_domain                    = var.site_domain
    origin_domain                  = local.origin_domain
    artifact_bucket                = local.artifact_bucket
    ops_bucket                     = local.ops_bucket
    ledger_table                   = local.ledger_table
    state_machine_arn              = local.state_machine_arn
    data_volume_id                 = aws_ebs_volume.data.id
    rate_limit_per_minute          = var.caddy_rate_limit_per_minute
    rate_limit_api_post_per_minute = var.caddy_rate_limit_api_post_per_minute
    web_memory_max_mb              = var.web_memory_max_mb
    web_node_heap_mb               = var.web_node_heap_mb
    worker_memory_max_mb           = var.worker_memory_max_mb
    worker_node_heap_mb            = var.worker_node_heap_mb
    script_env                     = base64gzip(file("${local.box_files}/bin/repohive-env"))
    script_first_boot              = base64gzip(file("${local.box_files}/bin/repohive-first-boot"))
    script_activate                = base64gzip(file("${local.box_files}/bin/repohive-activate"))
    script_heartbeat               = base64gzip(file("${local.box_files}/bin/repohive-heartbeat"))
    logrotate                      = base64gzip(file("${local.box_files}/logrotate-repohive"))
    agent_config                   = base64gzip(file("${local.box_files}/amazon-cloudwatch-agent.json"))
    units = {
      for name in fileset("${local.box_files}/systemd", "*.{service,timer}") :
      name => base64gzip(file("${local.box_files}/systemd/${name}"))
    }
  })
}

# --- log groups of the box; the agent ships into these ---------------------------------

resource "aws_cloudwatch_log_group" "box_web" {
  name              = local.log_group_box_web
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "box_worker" {
  name              = local.log_group_box_worker
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "box_caddy" {
  name              = local.log_group_box_caddy
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "box_heartbeat" {
  name              = local.log_group_box_heartbeat
  retention_in_days = var.log_retention_days
}

# --- the instance role ------------------------------------------------------------------------

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "box" {
  statement {
    sid       = "ReadRepositoryPointers"
    actions   = ["s3:GetObject"]
    resources = ["${local.artifact_bucket_arn}/r/*"]
  }

  # The SQLite backup: read, write, delete and a list limited to its prefix.
  statement {
    sid       = "BackupObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${local.artifact_bucket_arn}/backup/*"]
  }

  statement {
    sid       = "ListBackups"
    actions   = ["s3:ListBucket"]
    resources = [local.artifact_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["backup/*"]
    }
  }

  statement {
    sid       = "ReadReleases"
    actions   = ["s3:GetObject"]
    resources = ["${local.ops_bucket_arn}/releases/*"]
  }

  # The app also scans the table for "jobs ended since".
  statement {
    sid = "Ledger"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]
    resources = [local.ledger_table_arn, "${local.ledger_table_arn}/index/*"]
  }

  statement {
    sid       = "StartIndexing"
    actions   = ["states:StartExecution"]
    resources = [local.state_machine_arn]
  }

  statement {
    sid       = "ReadParameters"
    actions   = ["ssm:GetParameter"]
    resources = ["${local.parameter_arn_prefix}/*"]
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

resource "aws_iam_role" "box" {
  name               = "repohive-box"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

# Session Manager, Run Command and the CloudWatch agent, from the managed policies.
resource "aws_iam_role_policy_attachment" "box_ssm" {
  role       = aws_iam_role.box.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "box_cloudwatch_agent" {
  role       = aws_iam_role.box.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}

resource "aws_iam_role_policy" "box" {
  name   = "app"
  role   = aws_iam_role.box.id
  policy = data.aws_iam_policy_document.box.json
}

resource "aws_iam_instance_profile" "box" {
  name = "repohive-box"
  role = aws_iam_role.box.name
}

# --- the instance, its data volume and its address -----------------------------------------------------------

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_instance" "box" {
  ami                         = data.aws_ssm_parameter.al2023_arm64.insecure_value
  instance_type               = "t4g.small"
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.box.id]
  iam_instance_profile        = aws_iam_instance_profile.box.name
  associate_public_ip_address = true # a temporary address for first boot; the Elastic IP replaces it
  disable_api_termination     = true
  user_data                   = local.box_user_data

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.box_root_volume_gb
    encrypted   = true
  }

  tags = { Name = "repohive-box" }

  lifecycle {
    # A newer AMI must not replace the box. user_data runs on first boot only, so a later edit would only
    # show as a change that does nothing: units, Caddyfile and scripts ship with each release instead.
    ignore_changes = [ami, user_data]
  }

  depends_on = [
    aws_iam_role_policy.box,
    aws_iam_role_policy_attachment.box_ssm,
    aws_iam_role_policy_attachment.box_cloudwatch_agent,
  ]
}

resource "aws_ebs_volume" "data" {
  availability_zone = aws_subnet.public[0].availability_zone
  type              = "gp3"
  size              = var.box_data_volume_gb
  encrypted         = true

  tags = { Name = "repohive-data" }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_volume_attachment" "data" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.data.id
  instance_id                    = aws_instance.box.id
  stop_instance_before_detaching = true
}

resource "aws_eip" "box" {
  domain   = "vpc"
  instance = aws_instance.box.id

  tags = { Name = "repohive-box" }
}

# A failed system check recovers the instance on new hardware, with the same volumes and address.
resource "aws_cloudwatch_metric_alarm" "box_recover" {
  alarm_name          = "repohive-box-system-check"
  alarm_description   = "The box's system status check failed; recover it."
  namespace           = "AWS/EC2"
  metric_name         = "StatusCheckFailed_System"
  dimensions          = { InstanceId = aws_instance.box.id }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = ["arn:aws:automate:${local.region}:ec2:recover", aws_sns_topic.alerts.arn]
}

output "box_instance_id" {
  description = "The box's instance id (Session Manager: aws ssm start-session --target <id>)."
  value       = aws_instance.box.id
}

output "box_elastic_ip" {
  description = "The box's Elastic IP, the A record of the origin domain."
  value       = aws_eip.box.public_ip
}
