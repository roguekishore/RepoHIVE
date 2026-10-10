/**
 * The GitHub token read from SSM, against a mocked client.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { mockClient } from "aws-sdk-client-mock";
import { ConfigError, loadConfig } from "./config.js";
import { resolveGithubToken, resolveInternalSecret } from "./github-token.js";

const ssm = mockClient(SSMClient);
const SECRET = "github_pat_do-not-log-this-value";
const INTERNAL = "internal-secret-do-not-log";
const base = {
  REPOHIVE_RUNTIME: "lambda",
  REPOHIVE_STORE: "s3:bucket",
  REPOHIVE_SERVER_URL: "https://app.example.com",
  REPOHIVE_INTERNAL_SECRET: INTERNAL,
  AWS_REGION: "ap-south-1",
};

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
      () => loadConfig({ ...noRegion, REPOHIVE_STORE: "local:/tmp/x", REPOHIVE_GITHUB_TOKEN_PARAMETER: "/p" }),
      new ConfigError("AWS_REGION is not set"),
    );
  });
});

describe("internal secret and server URL configuration", () => {
  test("lambda and fargate need the server URL and a secret or its parameter", () => {
    for (const runtime of ["lambda", "fargate"]) {
      const env = { ...base, REPOHIVE_RUNTIME: runtime, REPOHIVE_GITHUB_TOKEN: "t0ken" };
      assert.equal(loadConfig(env).serverUrl, "https://app.example.com");
      const { REPOHIVE_SERVER_URL: _url, ...noUrl } = env;
      assert.throws(() => loadConfig(noUrl), new ConfigError("REPOHIVE_SERVER_URL is not set"));
      const { REPOHIVE_INTERNAL_SECRET: _secret, ...noSecret } = env;
      assert.throws(() => loadConfig(noSecret), new ConfigError("REPOHIVE_INTERNAL_SECRET is not set"));
      const viaParameter = loadConfig({ ...noSecret, REPOHIVE_INTERNAL_SECRET_PARAMETER: "/repohive/internal" });
      assert.equal(viaParameter.internalSecret, undefined);
      assert.equal(viaParameter.internalSecretParameter, "/repohive/internal");
    }
  });

  test("the internal secret parameter needs a region, and no error echoes the secret", () => {
    const { AWS_REGION: _region, ...noRegion } = base;
    const env = { ...noRegion, REPOHIVE_STORE: "local:/tmp/x", REPOHIVE_GITHUB_TOKEN: "t0ken", REPOHIVE_INTERNAL_SECRET_PARAMETER: "/p" };
    const { REPOHIVE_INTERNAL_SECRET: _s, ...withoutSecret } = env;
    assert.throws(() => loadConfig(withoutSecret), new ConfigError("AWS_REGION is not set"));
    assert.throws(
      () => loadConfig({ ...base, REPOHIVE_GITHUB_TOKEN: "t0ken", REPOHIVE_SERVER_URL: "ftp://x" }),
      (error: Error) => error instanceof ConfigError && !error.message.includes(INTERNAL),
    );
  });
});

describe("resolveInternalSecret", () => {
  test("reads the parameter once with decryption when the secret is not set", async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: ` ${INTERNAL}\n` } });
    const secret = await resolveInternalSecret({ internalSecret: undefined, internalSecretParameter: "/repohive/internal" });
    assert.equal(secret, INTERNAL);
    const calls = ssm.commandCalls(GetParameterCommand);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.args[0].input, { Name: "/repohive/internal", WithDecryption: true });
  });

  test("uses the environment value without calling SSM", async () => {
    assert.equal(await resolveInternalSecret({ internalSecret: "from-env", internalSecretParameter: "/p" }), "from-env");
    assert.equal(ssm.commandCalls(GetParameterCommand).length, 0);
  });

  test("a failed read names the parameter and the error class, never a value", async () => {
    ssm.on(GetParameterCommand).rejects(Object.assign(new Error(`denied for ${INTERNAL}`), { name: "AccessDeniedException" }));
    await assert.rejects(
      resolveInternalSecret({ internalSecret: undefined, internalSecretParameter: "/repohive/internal" }),
      (error: Error) => {
        assert.match(error.message, /internal secret parameter \/repohive\/internal/);
        assert.match(error.message, /AccessDeniedException/);
        assert.ok(!error.message.includes(INTERNAL));
        return true;
      },
    );
  });

  test("an empty parameter is an error", async () => {
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: "" } });
    await assert.rejects(resolveInternalSecret({ internalSecret: undefined, internalSecretParameter: "/p" }), /is empty/);
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
