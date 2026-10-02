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

variable "protect" {
  type        = bool
  description = "Keep true for production. False lets a destroy delete the ops bucket and the ECR repository with their contents (a test account that teardown.sh removes). The state bucket keeps prevent_destroy either way."
  default     = true
}

variable "account_name" {
  type        = string
  description = "The deploy/accounts/<name> folder of this account, which is also the GitHub environment the build workflow runs in for it."
  validation {
    condition     = can(regex("^[a-z][a-z0-9]{0,19}$", var.account_name))
    error_message = "account_name must be lower-case letters and digits, starting with a letter, at most 20 characters."
  }
}

variable "github_repository" {
  type        = string
  description = "owner/repo of the GitHub repository whose build workflow may push the image and the release (apply.sh reads it from the origin remote)."
  validation {
    condition     = can(regex("^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", var.github_repository))
    error_message = "github_repository must be owner/repo."
  }
}

variable "github_oidc_provider_arn" {
  type        = string
  description = "An existing token.actions.githubusercontent.com OIDC provider in this account, if there is one (an account holds at most one per URL). Empty: this root creates it."
  default     = ""
}

variable "github_subject_prefix" {
  type        = string
  description = "The repository part of the OIDC subject GitHub issues, for example repo:owner@123/repo@456 when the repository uses immutable subjects (apply.sh reads it from GitHub's OIDC customization API). Empty: repo:<github_repository>."
  default     = ""
  validation {
    condition     = var.github_subject_prefix == "" || can(regex("^repo:[^:]+$", var.github_subject_prefix))
    error_message = "github_subject_prefix must be empty or repo:<owner>/<repo> in either GitHub form, with no environment part."
  }
}
