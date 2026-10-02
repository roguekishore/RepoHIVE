# The smallest network that lets Fargate and the box reach the internet (Requirement 4): two public
# subnets, one route table, gateway endpoints for S3 and DynamoDB. No NAT gateway, no private subnet,
# no interface endpoint. Lambda runs outside the VPC.

data "aws_availability_zones" "available" {
  state = "available"
}

# CloudFront's origin-facing addresses, as a managed prefix list found by name (Requirement 4.4).
data "aws_ec2_managed_prefix_list" "cloudfront_origin" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "repohive" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "repohive" }
}

resource "aws_subnet" "public" {
  count = 2

  vpc_id                  = aws_vpc.main.id
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  map_public_ip_on_launch = false

  tags = { Name = "repohive-public-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "repohive-public" }
}

resource "aws_route_table_association" "public" {
  count = 2

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Gateway endpoints cost nothing and keep S3 and DynamoDB traffic off the internet gateway.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${local.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]

  tags = { Name = "repohive-s3" }
}

resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${local.region}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]

  tags = { Name = "repohive-dynamodb" }
}

# Fargate tasks: no inbound rule, outbound TCP 443 only (Requirement 4.3).
resource "aws_security_group" "fargate" {
  name        = "repohive-fargate"
  description = "Indexer tasks: no inbound, outbound HTTPS only"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "repohive-fargate" }
}

resource "aws_vpc_security_group_egress_rule" "fargate_https" {
  security_group_id = aws_security_group.fargate.id
  description       = "HTTPS to GitHub, S3, DynamoDB, ECR and CloudWatch"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# The box: 443 from CloudFront only, 80 for ACME HTTP-01 and the redirect, no SSH (Requirement 4.4).
# The prefix list counts as 55 rules of the default 60, so nothing else may be added beyond these.
resource "aws_security_group" "box" {
  name        = "repohive-box"
  description = "App box: HTTPS from CloudFront, HTTP for ACME, no SSH"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "repohive-box" }
}

resource "aws_vpc_security_group_ingress_rule" "box_https_cloudfront" {
  security_group_id = aws_security_group.box.id
  description       = "HTTPS from CloudFront origin-facing addresses"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin.id
}

resource "aws_vpc_security_group_ingress_rule" "box_http" {
  security_group_id = aws_security_group.box.id
  description       = "HTTP: ACME HTTP-01 challenge and the redirect to HTTPS only"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "box_http" {
  security_group_id = aws_security_group.box.id
  description       = "HTTP for package repositories"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "box_https" {
  security_group_id = aws_security_group.box.id
  description       = "HTTPS to AWS APIs, the ACME CA and the site"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}
