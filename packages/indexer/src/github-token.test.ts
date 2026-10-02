/**
 * The GitHub token read from SSM (hosting-4 Requirement 12.4), against a mocked client.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { mockClient } from "aws-sdk-client-mock";
import { ConfigError, loadConfig } from "./config.js";
import { resolveGithubToken } from "./github-token.js";

const ssm = mockClient(SSMClient);
const SECRET = "github_pat_do-not-log-this-value";
const base = { REPOHIVE_RUNTIME: "lambda", REPOHIVE_STORE: "s3:bucket", REPOHIVE_LEDGER: "dynamodb:table", AWS_REGION: "ap-south-1" };

beforeEach(() => ssm.reset());

describe("configuration", () => {
  test("the parameter name stands in for the token", () => {
    const config = loadConfig({ ...base, REPOHIVE_GITHUB_TOKEN_PARAMETER: "/repohive/github-token" });
    assert.equal(config.githubToken, undefined);
    assert.equal(config.githubTokenParameter, "/repohive/github-token");
  });

  test("a token or a parameter is still required outside a local run", () => {
    assert.throws(() => loadConfig(base), new ConfigError("REPOHIVE_GITHUB_TOKEN is not set"));
  });

  test("the parameter needs a region", () => {
    const { AWS_REGION: _region, ...noRegion } = base;
    assert.throws(
      () => loadConfig({ ...noRegion, REPOHIVE_STORE: "local:/tmp/x", REPOHIVE_LEDGER: "memory", REPOHIVE_GITHUB_TOKEN_PARAMETER: "/p" }),
      new ConfigError("AWS_REGION is not set"),
    );
  });
});

describe("resolveGithubToken", () => {
  test("reads the parameter with decryption when the token is not set", async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: ` ${SECRET}\n` } });
    const token = await resolveGithubToken({ githubToken: undefined, githubTokenParameter: "/repohive/github-token" });
    assert.equal(token, SECRET);
    const calls = ssm.commandCalls(GetParameterCommand);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args[0].input, { Name: "/repohive/github-token", WithDecryption: true });
  });

  test("does not call SSM when the token is already in the environment", async () => {
    const token = await resolveGithubToken({ githubToken: "from-env", githubTokenParameter: "/repohive/github-token" });
    assert.equal(token, "from-env");
    assert.equal(ssm.commandCalls(GetParameterCommand).length, 0);
  });

  test("does not call SSM for a local run", async () => {
    assert.equal(await resolveGithubToken({ githubToken: undefined, githubTokenParameter: undefined }), undefined);
    assert.equal(ssm.commandCalls(GetParameterCommand).length, 0);
  });

  test("a failed read names the parameter and the error class, never a value", async () => {
    ssm.on(GetParameterCommand).rejects(Object.assign(new Error(`denied for ${SECRET}`), { name: "AccessDeniedException" }));
    await assert.rejects(
      resolveGithubToken({ githubToken: undefined, githubTokenParameter: "/repohive/github-token" }),
      (error: Error) => {
        assert.match(error.message, /\/repohive\/github-token/);
        assert.match(error.message, /AccessDeniedException/);
        assert.ok(!error.message.includes(SECRET));
        return true;
      },
    );
  });

  test("an empty parameter is an error", async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: "  " } });
    await assert.rejects(
      resolveGithubToken({ githubToken: undefined, githubTokenParameter: "/repohive/github-token" }),
      /is empty/,
    );
  });
});
