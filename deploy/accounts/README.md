# deploy/accounts

One folder per AWS account. Everything in this directory except this file is git-ignored. A script works on the
account named by `REPOHIVE_ACCOUNT=<name>` and reads nothing of any other.

```
deploy/accounts/<name>/
  deploy.env            required: copy deploy/deploy.env.example and fill it in
  bootstrap.tfvars      optional tuning of the bootstrap root (none today)
  main.tfvars           optional tuning of the main root (deploy/terraform/main/prod.tfvars.example lists the knobs)
  bootstrap.tfstate     written by the first bootstrap apply: the only record of the bootstrap resources; back it up
  .terraform-bootstrap/ Terraform working directories, one per root (recreated by init)
  .terraform-main/
  out/                  saved plans and the last pushed image digest
```

The main root's state is not here: it lives in the account's own state bucket (`repohive-tfstate-<account id>`).

To deploy into another account: create its folder with its own `deploy.env`, point the `repohive` profile at that
account's credentials, and run the same commands with the new `REPOHIVE_ACCOUNT`. `deploy/RUNBOOK.md` has the order.
