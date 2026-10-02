# The ledger table. Its key schema, attributes and indexes come from ledger-schema.json,
# which a unit test in packages/indexer keeps equal to the layout the DynamoDB JobLedger uses.
#
# On-demand capacity, not the always-free provisioned tier: a throttled read would break live progress
#. Expected cost is cents a month (estimate, not measured).

locals {
  ledger_schema = jsondecode(file("${path.module}/ledger-schema.json"))
}

resource "aws_dynamodb_table" "ledger" {
  name         = local.ledger_table
  billing_mode = "PAY_PER_REQUEST"

  hash_key = one([for k in local.ledger_schema.keySchema : k.attributeName if k.keyType == "HASH"])
  range_key = try(
    one([for k in local.ledger_schema.keySchema : k.attributeName if k.keyType == "RANGE"]),
    null,
  )

  dynamic "attribute" {
    for_each = local.ledger_schema.attributeDefinitions

    content {
      name = attribute.value.attributeName
      type = attribute.value.attributeType
    }
  }

  dynamic "global_secondary_index" {
    for_each = local.ledger_schema.globalSecondaryIndexes

    content {
      name = global_secondary_index.value.indexName
      key_schema {
        attribute_name = one([for k in global_secondary_index.value.keySchema : k.attributeName if k.keyType == "HASH"])
        key_type       = "HASH"
      }
      projection_type = global_secondary_index.value.projection
    }
  }

  ttl {
    attribute_name = local.ledger_schema.ttlAttribute
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  deletion_protection_enabled = true
}
