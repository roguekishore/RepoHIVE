# S3 backend with native locking (Terraform 1.11 or later): no DynamoDB lock table. apply.sh passes the bucket
# (repohive-tfstate-<account id>), the key (main/terraform.tfstate) and the region as -backend-config values.
terraform {
  backend "s3" {
    use_lockfile = true
    encrypt      = true
  }
}
