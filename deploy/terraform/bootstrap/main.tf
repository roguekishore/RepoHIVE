# The bootstrap root: applied once, with local state. It creates what the
# main root needs before it can run: the state bucket, the ops bucket, the registry and the
# CloudFront certificate.

locals {
  state_bucket = "repohive-tfstate-${var.aws_account_id}"
  ops_bucket   = "repohive-ops-${var.aws_account_id}"

  # Both buckets get the same protections; the keys are static so for_each is known at plan time.
  protected_buckets = {
    state = aws_s3_bucket.state.id
    ops   = aws_s3_bucket.ops.id
  }
}

# --- buckets -----------------------------------------------------------------------------------

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket" "ops" {
  bucket = local.ops_bucket

  # Only an unprotected (test) account lets a destroy delete it with release bundles in it.
  force_destroy = !var.protect
}

resource "aws_s3_bucket_public_access_block" "protected" {
  for_each = local.protected_buckets

  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "protected" {
  for_each = local.protected_buckets

  bucket = each.value

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "protected" {
  for_each = local.protected_buckets

  bucket = each.value

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "deny_insecure_transport" {
  for_each = local.protected_buckets

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::${each.value}",
      "arn:aws:s3:::${each.value}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "protected" {
  for_each = local.protected_buckets

  bucket = each.value
  policy = data.aws_iam_policy_document.deny_insecure_transport[each.key].json

  # S3 rejects concurrent public-access-block and policy writes to one bucket; serialise them.
  depends_on = [aws_s3_bucket_public_access_block.protected]
}

# The state bucket is versioned so a bad state can be recovered.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

# The ops bucket holds release bundles only; versioning stays off.
resource "aws_s3_bucket_lifecycle_configuration" "ops" {
  bucket = aws_s3_bucket.ops.id

  rule {
    id     = "expire-releases"
    status = "Enabled"

    filter {
      prefix = "releases/"
    }

    expiration {
      days = 60
    }
  }
}

# --- registry ----------------------------------------------------------------

resource "aws_ecr_repository" "indexer" {
  name                 = "repohive/indexer"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = !var.protect

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "indexer" {
  repository = aws_ecr_repository.indexer.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 10 newest images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# --- CloudFront certificate --------------------------------------------------
# DNS-validated, with no validation resource: the records live in Netlify, so Terraform cannot wait on them.

resource "aws_acm_certificate" "site" {
  provider = aws.us_east_1

  domain_name       = var.site_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}
