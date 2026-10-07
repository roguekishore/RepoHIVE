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

variable "protect" {
  type        = bool
  description = "Deletion protection on the ledger table and termination protection on the box; false also lets a destroy empty the artifact bucket. Keep true for production; false only for a test account that teardown.sh will remove. The data volume keeps prevent_destroy either way."
  default     = true
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

variable "indexer_image_digest" {
  type        = string
  description = "Digest of the indexer image in ECR, as push-indexer-image.sh prints it (sha256:<64 hex>). Lambda and the task definition run the image by digest."

  validation {
    condition     = can(regex("^sha256:[0-9a-f]{64}$", var.indexer_image_digest))
    error_message = "indexer_image_digest must look like sha256: followed by 64 lower-case hex digits."
  }
}

variable "lambda_memory_mb" {
  type        = number
  description = "Memory of the S and M indexer function. 3,008 MB is the most a fresh account may allow."
  default     = 3008

  validation {
    condition     = var.lambda_memory_mb >= 512 && var.lambda_memory_mb <= 3008
    error_message = "lambda_memory_mb must be between 512 and 3008."
  }
}

variable "lambda_timeout_seconds" {
  type        = number
  description = "Timeout of the S and M indexer function (the S and M tier timeout)."
  default     = 300

  validation {
    condition     = var.lambda_timeout_seconds >= 30 && var.lambda_timeout_seconds <= 900
    error_message = "lambda_timeout_seconds must be between 30 and 900."
  }
}

variable "lambda_ephemeral_storage_mb" {
  type        = number
  description = "Ephemeral storage of the S and M indexer function."
  default     = 512

  validation {
    condition     = var.lambda_ephemeral_storage_mb >= 512 && var.lambda_ephemeral_storage_mb <= 10240
    error_message = "lambda_ephemeral_storage_mb must be between 512 and 10240."
  }
}

variable "fargate_cpu_units" {
  type        = number
  description = "CPU units of the L and XL indexer task (1024 per vCPU); 8192 is 8 vCPU."
  default     = 8192

  validation {
    condition     = contains([1024, 2048, 4096, 8192, 16384], var.fargate_cpu_units)
    error_message = "fargate_cpu_units must be 1024, 2048, 4096, 8192 or 16384."
  }
}

variable "fargate_memory_mb" {
  type        = number
  description = "Memory of the L and XL indexer task in MB; 16384 is 16 GB, valid with 8 vCPU."
  default     = 16384

  validation {
    condition     = var.fargate_memory_mb >= 2048 && var.fargate_memory_mb <= 122880
    error_message = "fargate_memory_mb must be between 2048 and 122880."
  }
}
