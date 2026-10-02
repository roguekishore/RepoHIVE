# Alarms and budget (Requirement 17). Eight alarms, under the free allowance of ten, all to one SNS topic that
# emails var.alert_email. The box recover alarm is in box.tf and also names this topic.

resource "aws_sns_topic" "alerts" {
  name = "repohive-alerts"
}

# The owner confirms the subscription from the email AWS sends (runbook).
resource "aws_sns_topic_subscription" "alerts_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  alarm_actions = [aws_sns_topic.alerts.arn]
  alarm_period  = 300
}

# --- Step Functions (Requirement 17.2) -----------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "executions_failed" {
  alarm_name          = "repohive-index-executions-failed"
  alarm_description   = "Index executions ended FAILED."
  namespace           = "AWS/States"
  metric_name         = "ExecutionsFailed"
  dimensions          = { StateMachineArn = local.state_machine_arn }
  statistic           = "Sum"
  period              = local.alarm_period
  evaluation_periods  = 1
  threshold           = var.alarm_thresholds.executions_failed
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "executions_timed_out" {
  alarm_name          = "repohive-index-executions-timed-out"
  alarm_description   = "Index executions ended TIMED_OUT."
  namespace           = "AWS/States"
  metric_name         = "ExecutionsTimedOut"
  dimensions          = { StateMachineArn = local.state_machine_arn }
  statistic           = "Sum"
  period              = local.alarm_period
  evaluation_periods  = 1
  threshold           = var.alarm_thresholds.executions_timed_out
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

# --- Lambda ------------------------------------------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "indexer_errors" {
  alarm_name          = "repohive-indexer-errors"
  alarm_description   = "The indexer function raised errors (not job failures, which the job reports itself)."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = local.indexer_function }
  statistic           = "Sum"
  period              = local.alarm_period
  evaluation_periods  = 1
  threshold           = var.alarm_thresholds.indexer_errors
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "indexer_throttles" {
  alarm_name          = "repohive-indexer-throttles"
  alarm_description   = "The indexer function was throttled: the account's concurrency is below the in-flight cap."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  dimensions          = { FunctionName = local.indexer_function }
  statistic           = "Sum"
  period              = local.alarm_period
  evaluation_periods  = 1
  threshold           = var.alarm_thresholds.indexer_throttles
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "control_errors" {
  alarm_name          = "repohive-control-errors"
  alarm_description   = "The control function raised errors: the state machine could not reach the ledger."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = local.control_function }
  statistic           = "Sum"
  period              = local.alarm_period
  evaluation_periods  = 1
  threshold           = var.alarm_thresholds.control_errors
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

# --- system failures reported by the jobs (hosting-2 Requirement 11) ---------------------------------------------------
# JobsFailed carries the dimensions Tier, Runtime and Class together, so one alarm cannot name Class alone: this
# sums the metric over every Tier and Runtime a system failure can carry. The control function reports the
# failures the job never could (failIfOpen), always with Runtime = lambda. A combination that never occurs has
# no data and counts as zero.

locals {
  jobs_failed_system_combinations = {
    for pair in setproduct(["S", "M", "L", "XL"], ["lambda", "fargate"]) :
    "m_${lower(pair[0])}_${pair[1]}" => { tier = pair[0], runtime = pair[1] }
  }
}

resource "aws_cloudwatch_metric_alarm" "jobs_failed_system" {
  alarm_name          = "repohive-jobs-failed-system"
  alarm_description   = "Jobs failed for a system reason (Class = system), summed over every tier and runtime."
  evaluation_periods  = 1
  threshold           = var.alarm_thresholds.jobs_failed_system
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions

  metric_query {
    id          = "total"
    expression  = "SUM(METRICS())"
    label       = "JobsFailed, Class = system"
    return_data = true
  }

  dynamic "metric_query" {
    for_each = local.jobs_failed_system_combinations

    content {
      id          = metric_query.key
      return_data = false

      metric {
        namespace   = "RepoHIVE/Hosted"
        metric_name = "JobsFailed"
        period      = local.alarm_period
        stat        = "Sum"
        dimensions = {
          Class   = "system"
          Runtime = metric_query.value.runtime
          Tier    = metric_query.value.tier
        }
      }
    }
  }
}

# --- the site heartbeat (Requirement 17.3) ----------------------------------------------------------------------------
# The box writes SiteUp = 1 or 0 every minute. Five bad minutes in a row alarm, and missing data is bad too, so a
# dead box (which writes nothing) alarms as well.

resource "aws_cloudwatch_metric_alarm" "heartbeat" {
  alarm_name          = "repohive-site-heartbeat"
  alarm_description   = "The site did not answer /healthz through CloudFront, or the box stopped reporting."
  namespace           = "RepoHIVE/Hosted"
  metric_name         = "SiteUp"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = var.alarm_thresholds.heartbeat_bad_minutes
  datapoints_to_alarm = var.alarm_thresholds.heartbeat_bad_minutes
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
}

# --- the budget (Requirement 17.5) -------------------------------------------------------------------------------------

resource "aws_budgets_budget" "monthly" {
  name         = "repohive-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}
