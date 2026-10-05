variable "aws_account_id" {
  type        = string
  description = "The 12-digit id of the fresh ap-south-1 account. Every provider refuses any other account."

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be exactly 12 digits."
  }
}

variable "owner_tag" {
  type        = string
  description = "Value of the Owner tag on every resource."

  validation {
    condition     = length(trimspace(var.owner_tag)) > 0
    error_message = "owner_tag must not be empty."
  }
}

variable "site_domain" {
  type        = string
  description = "The public name users visit, served by CloudFront: repohive.dev or a name under it. Must match the bootstrap root."

  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)*repohive\\.dev$", var.site_domain))
    error_message = "site_domain must be repohive.dev or a lower-case name under it."
  }
}

variable "alert_email" {
  type        = string
  description = "Address that receives every alarm and budget notice."

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must look like an email address."
  }
}

variable "log_retention_days" {
  type        = number
  description = "Retention for every CloudWatch log group."
  default     = 14

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365], var.log_retention_days)
    error_message = "log_retention_days must be a retention value CloudWatch Logs accepts."
  }
}
