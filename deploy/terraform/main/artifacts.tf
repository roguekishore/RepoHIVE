# The artifact bucket (Requirement 5.1 and 5.2): snapshots, index files, repository pointers, metadata and
# the SQLite backup. Not versioned and no lifecycle rule (hosted-snapshots-are-immutable-url-shaped-keys).
# Ownership and cost tags come from the provider's default_tags, which put them on the bucket itself; no
# object is tagged (hosting-2 Requirement 7.6).

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

  # Views only: snapshots (s/) and repository pointers (r/). idx/, meta/ and backup/ are not granted to
  # anyone outside the account, and CloudFront has no behaviour for them (Requirement 5.7).
  statement {
    sid       = "CloudFrontReadsViews"
    actions   = ["s3:GetObject"]
    resources = ["${local.artifact_bucket_arn}/s/*", "${local.artifact_bucket_arn}/r/*"]

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

  # With list permission a missing key answers 404 instead of 403 (hosting-3 Requirement 2.3).
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
