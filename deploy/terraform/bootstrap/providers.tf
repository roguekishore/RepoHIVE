locals {
  region = "ap-south-1"

  default_tags = {
    Project     = "repohive"
    Environment = "prod"
    ManagedBy   = "terraform"
    Owner       = var.owner_tag
    CostCenter  = "repohive-hosted"
  }
}

provider "aws" {
  region              = local.region
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = local.default_tags
  }
}

# Used only for the CloudFront certificate, which must live in us-east-1.
provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = local.default_tags
  }
}
