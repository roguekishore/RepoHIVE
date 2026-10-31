output "state_bucket" {
  description = "Terraform state bucket for the main root's backend."
  value       = aws_s3_bucket.state.id
}

output "ops_bucket" {
  description = "Bucket of the release bundles from before ./ops ship."
  value       = aws_s3_bucket.ops.id
}

output "deploy_bucket" {
  description = "Bucket of the releases ./ops ship builds (releases/<sha12>.tar.gz)."
  value       = aws_s3_bucket.deploy.id
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

output "github_deploy_role_arn" {
  description = "The role the deploy workflow assumes in this account (its name is fixed: repohive-github-deploy)."
  value       = aws_iam_role.github_deploy.arn
}
