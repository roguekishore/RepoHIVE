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
  description = "Value of the Owner tag on every resource (the owner's name or email)."

  validation {
    condition     = length(trimspace(var.owner_tag)) > 0
    error_message = "owner_tag must not be empty."
  }
}

variable "site_domain" {
  type        = string
  description = "The public name users visit, repohive.dev or a name under it. The CloudFront certificate is issued for it."

  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?\\.)*repohive\\.dev$", var.site_domain))
    error_message = "site_domain must be repohive.dev or a lower-case name under it."
  }
}
