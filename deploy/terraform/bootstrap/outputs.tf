output "state_bucket" {
  description = "Terraform state bucket for the main root's backend."
  value       = aws_s3_bucket.state.id
}

output "ops_bucket" {
  description = "Bucket for release bundles."
  value       = aws_s3_bucket.ops.id
}

output "ecr_repository_url" {
  description = "Registry URL of the indexer image."
  value       = aws_ecr_repository.indexer.repository_url
}

output "certificate_arn" {
  description = "CloudFront certificate (us-east-1). Wait for ISSUED before the main apply."
  value       = aws_acm_certificate.site.arn
}

output "certificate_validation_records" {
  description = "CNAME records to add in Netlify DNS so the certificate validates."
  value = [
    for o in aws_acm_certificate.site.domain_validation_options : {
      name  = o.resource_record_name
      type  = o.resource_record_type
      value = o.resource_record_value
    }
  ]
}

output "github_build_role_arn" {
  description = "The role the build workflow assumes in this account (its name is fixed: repohive-github-build)."
  value       = aws_iam_role.github_build.arn
}
