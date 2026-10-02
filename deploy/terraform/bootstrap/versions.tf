terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  # Local state, kept per account: apply.sh passes -backend-config=path=../../accounts/<name>/bootstrap.tfstate.
  backend "local" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.67.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.9.1"
    }
  }
}
