# CloudFront: one distribution serves the site domain. Snapshot objects come from the artifact
# bucket (/artifacts/*); the exported viewer, the API and /healthz come from the box through its origin domain.

# The bootstrap root created the certificate; the owner validated it in Netlify DNS. Looking it up with status
# ISSUED makes this root fail clearly if validation is not done yet.
data "aws_acm_certificate" "site" {
  provider = aws.us_east_1

  domain      = var.site_domain
  statuses    = ["ISSUED"]
  most_recent = true
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_origin_access_control" "artifacts" {
  name                              = "repohive-artifacts"
  description                       = "SigV4 access to the artifact bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Snapshot objects are keyed on the path alone: no header, cookie or query string. The stored Cache-Control of
# Every object under a snapshot id is immutable, so the minimum is 0 and the
# maximum a year. Objects are stored brotli and served as they are, so Accept-Encoding is not normalised.
resource "aws_cloudfront_cache_policy" "views" {
  name        = "repohive-views"
  comment     = "Path-only cache key; the stored Cache-Control decides the lifetime"
  min_ttl     = 0
  default_ttl = 60
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = false
    enable_accept_encoding_gzip   = false

    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# No includeSubDomains: the site domain may be the apex, and other names under it must not be forced to HTTPS
# by this header. Headers the app sets win.
resource "aws_cloudfront_response_headers_policy" "hsts" {
  name    = "repohive-hsts"
  comment = "Strict-Transport-Security, without overriding the app's own headers"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = false
      preload                    = false
      override                   = false
    }
  }
}

locals {
  s3_origin_id  = "artifacts"
  box_origin_id = "box"
  all_methods   = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
}

resource "aws_cloudfront_distribution" "site" {
  enabled         = true
  comment         = "RepoHIVE: ${var.site_domain}"
  aliases         = [var.site_domain]
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = "PriceClass_200"

  origin {
    origin_id                = local.s3_origin_id
    domain_name              = aws_s3_bucket.artifacts.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.artifacts.id
  }

  origin {
    origin_id   = local.box_origin_id
    domain_name = local.origin_domain

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60
      origin_keepalive_timeout = 5
    }

    # The exact header name Caddy requires (deploy/box/Caddyfile).
    custom_header {
      name  = "X-RepoHIVE-Origin-Secret"
      value = random_password.origin_secret.result
    }
  }

  # Snapshot objects: GET and HEAD, never compressed by CloudFront (the objects are brotli already). The object
  # key equals the URL path (artifacts/<owner>/<repo>/<snapshot id>/...), so the origin needs no rewrite. This is
  # the only behaviour that reaches the bucket: no behaviour, and no bucket policy statement, covers private/,
  # which holds the compact index and the pruning record, or backup/.
  ordered_cache_behavior {
    path_pattern               = "/artifacts/*"
    target_origin_id           = local.s3_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = false
    cache_policy_id            = aws_cloudfront_cache_policy.views.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.hsts.id
  }

  ordered_cache_behavior {
    path_pattern               = "/_next/static/*"
    target_origin_id           = local.box_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.hsts.id
  }

  # Server-sent events: no caching, no compression, so the stream is not buffered.
  ordered_cache_behavior {
    path_pattern               = "/api/jobs/*"
    target_origin_id           = local.box_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = local.all_methods
    cached_methods             = ["GET", "HEAD"]
    compress                   = false
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.hsts.id
  }

  # The server's API (sign-in, index requests, job status, the workers' /api/internal/** calls, the limits page's
  # /api/admin/**): never cached, every method (the limits page sends a preflighted PUT and DELETE) and every
  # viewer header except Host, so Authorization and Origin reach the server.
  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = local.box_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = local.all_methods
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.hsts.id
  }

  default_cache_behavior {
    target_origin_id           = local.box_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = local.all_methods
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.hsts.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.site.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

output "cloudfront_domain_name" {
  description = "The distribution's domain name: the CNAME target of the site domain."
  value       = aws_cloudfront_distribution.site.domain_name
}

# Every record the owner adds in Netlify DNS after the main apply. The certificate's validation
# records come from the bootstrap root's outputs and are added before this root runs. Nothing here waits on them:
# Caddy retries its certificate until the origin A record resolves.
output "dns_records" {
  description = "Records to add in Netlify DNS after the main apply."
  value = [
    {
      name    = var.site_domain
      type    = "CNAME"
      value   = aws_cloudfront_distribution.site.domain_name
      purpose = "Site domain to the CloudFront distribution"
    },
    {
      name    = local.origin_domain
      type    = "A"
      value   = aws_eip.box.public_ip
      purpose = "Origin domain to the box (used only by CloudFront)"
    },
  ]
}
