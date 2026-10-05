# S3 backend with native locking (Terraform 1.11 or later): no DynamoDB lock table. The bucket, key and
# region come from a -backend-config file; see backend.hcl.example.
terraform {
  backend "s3" {
    use_lockfile = true
    encrypt      = true
  }
}
