# The artifact bucket: public snapshot objects (artifacts/), the compact index and the
# pruning record (private/) and the SQLite backup (backup/). Not versioned and no lifecycle rule
# (hosted-snapshots-are-immutable-url-shaped-keys). Ownership and cost tags come from the provider's
# default_tags, which put them on the bucket itself; no object is tagged.

locals {
  # The prefixes CloudFront may read: the public snapshot objects and nothing else. The compact index and the
  # pruning record under private/ and the SQLite backup under backup/ are never listed here.
  public_object_prefixes = ["artifacts"]
}

resource "aws_s3_bucket" "artifacts" {
  bucket = local.artifact_bucket

  # Only an unprotected (test) account lets a destroy delete the bucket with its snapshots in it.
  force_destroy = !var.protect
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "artifacts_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      local.artifact_bucket_arn,
      "${local.artifact_bucket_arn}/*",
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

  # Public snapshot objects only (artifacts/). private/ and backup/ are not granted to anyone outside the account,
  # and CloudFront has no behaviour for them.
  statement {
    sid       = "CloudFrontReadsArtifacts"
    actions   = ["s3:GetObject"]
    resources = [for p in local.public_object_prefixes : "${local.artifact_bucket_arn}/${p}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }

  # With list permission a missing key answers 404 instead of 403.
  statement {
    sid       = "CloudFrontListsForNotFound"
    actions   = ["s3:ListBucket"]
    resources = [local.artifact_bucket_arn]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  policy = data.aws_iam_policy_document.artifacts_bucket.json

  # S3 rejects concurrent public-access-block and policy writes to one bucket; serialise them.
  depends_on = [aws_s3_bucket_public_access_block.artifacts]
}
