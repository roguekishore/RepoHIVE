# Alarm and budget thresholds (Requirement 17.4). Defaults are stated in the runbook.

variable "alarm_thresholds" {
  type = object({
    executions_failed     = optional(number, 1)
    executions_timed_out  = optional(number, 1)
    indexer_errors        = optional(number, 3)
    indexer_throttles     = optional(number, 1)
    control_errors        = optional(number, 1)
    jobs_failed_system    = optional(number, 3)
    heartbeat_bad_minutes = optional(number, 5)
  })
  description = "Alarm thresholds. Counts are totals over one 5-minute period, except heartbeat_bad_minutes, which is consecutive minutes without a good SiteUp."
  default     = {}

  validation {
    condition = alltrue([
      for v in values(var.alarm_thresholds) : v >= 1
    ])
    error_message = "Every alarm threshold must be at least 1."
  }
}

variable "monthly_budget_usd" {
  type        = number
  description = "Monthly cost budget in USD. Emails at 80% of actual and 100% of forecast spend."
  default     = 25

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be positive."
  }
}
