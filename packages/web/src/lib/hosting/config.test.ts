/**
 * Validated settings (errors name the variable and
 * never echo a value) and no secret reaching the client bundle.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_CONFIG_VARIABLES, ConfigError, parseAppConfig, type AppConfigVariable } from "./config";

const cwd = path.resolve("/srv/app");

const LOCAL = {
  REPOHIVE_MODE: "local",
  REPOHIVE_SITE_ORIGIN: "http://localhost:3000",
  REPOHIVE_DATA_DIR: "data",
  REPOHIVE_STORE: "local:store",
  REPOHIVE_LEDGER: "file:ledger.json",
  REPOHIVE_ORCHESTRATOR: "local",
};

const HOSTED = {
  REPOHIVE_MODE: "hosted",
  REPOHIVE_SITE_ORIGIN: "https://repohive.example",
  REPOHIVE_DATA_DIR: "/var/lib/repohive",
  REPOHIVE_STORE: "s3:repohive-artifacts",
  REPOHIVE_LEDGER: "dynamodb:repohive-ledger",
  REPOHIVE_ORCHESTRATOR: "sfn:arn:aws:states:ap-south-1:123456789012:stateMachine:repohive-index",
  REPOHIVE_GITHUB_TOKEN: "ghp_secretvalue",
  REPOHIVE_CLIENT_IP_HEADER: "X-RepoHIVE-Client-IP",
  AWS_REGION: "ap-south-1",
};

function failure(env: Record<string, string | undefined>): ConfigError {
  try {
    parseAppConfig(env, cwd);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

function expectRejected(env: Record<string, string | undefined>, variable: AppConfigVariable): void {
  const error = failure(env);
  expect(error.variable).toBe(variable);
  expect(error.message.startsWith(variable)).toBe(true);
}

describe("parseAppConfig: local mode", () => {
  it("accepts the local settings and resolves paths against the working directory", () => {
    const config = parseAppConfig(LOCAL, cwd);
    expect(config).toEqual({
      mode: "local",
      siteOrigin: "http://localhost:3000",
      dataDirectory: path.resolve(cwd, "data"),
      store: { kind: "local", directory: path.resolve(cwd, "store") },
      ledger: { kind: "file", path: path.resolve(cwd, "ledger.json") },
      orchestrator: { kind: "local" },
      githubToken: undefined,
      clientIpHeader: undefined,
      awsRegion: undefined,
      quota: {
        acceptedPerAccountPerDay: 5,
        acceptedPerIpPerDay: 10,
        prechecksPerAccountPerHour: 20,
        prechecksPerIpPerHour: 40,
      },
    });
  });

  it("ignores the client-IP header: local mode reads the socket address", () => {
    expect(parseAppConfig({ ...LOCAL, REPOHIVE_CLIENT_IP_HEADER: "x-forwarded-for" }, cwd).clientIpHeader).toBeUndefined();
  });

  it("requires a local store, a file ledger and the local orchestrator", () => {
    expectRejected({ ...LOCAL, REPOHIVE_STORE: "s3:bucket", AWS_REGION: "ap-south-1" }, "REPOHIVE_STORE");
    expectRejected({ ...LOCAL, REPOHIVE_LEDGER: "dynamodb:table", AWS_REGION: "ap-south-1" }, "REPOHIVE_LEDGER");
    expectRejected({ ...LOCAL, REPOHIVE_LEDGER: "memory" }, "REPOHIVE_LEDGER");
    expectRejected({ ...LOCAL, REPOHIVE_ORCHESTRATOR: HOSTED.REPOHIVE_ORCHESTRATOR, AWS_REGION: "x" }, "REPOHIVE_ORCHESTRATOR");
  });
});

describe("parseAppConfig: hosted mode", () => {
  it("accepts the hosted settings", () => {
    const config = parseAppConfig(HOSTED, cwd);
    expect(config.mode).toBe("hosted");
    expect(config.store).toEqual({ kind: "s3", bucket: "repohive-artifacts" });
    expect(config.ledger).toEqual({ kind: "dynamodb", table: "repohive-ledger" });
    expect(config.orchestrator).toEqual({
      kind: "sfn",
      stateMachineArn: "arn:aws:states:ap-south-1:123456789012:stateMachine:repohive-index",
    });
    expect(config.githubToken).toBe("ghp_secretvalue");
    expect(config.clientIpHeader).toBe("x-repohive-client-ip");
    expect(config.awsRegion).toBe("ap-south-1");
  });

  it("requires https, the token, the client-IP header and the AWS region", () => {
    expectRejected({ ...HOSTED, REPOHIVE_SITE_ORIGIN: "http://repohive.example" }, "REPOHIVE_SITE_ORIGIN");
    expectRejected({ ...HOSTED, REPOHIVE_GITHUB_TOKEN: undefined }, "REPOHIVE_GITHUB_TOKEN");
    expectRejected({ ...HOSTED, REPOHIVE_CLIENT_IP_HEADER: undefined }, "REPOHIVE_CLIENT_IP_HEADER");
    expectRejected({ ...HOSTED, REPOHIVE_CLIENT_IP_HEADER: "bad header" }, "REPOHIVE_CLIENT_IP_HEADER");
    expectRejected({ ...HOSTED, AWS_REGION: " " }, "AWS_REGION");
  });

  it("requires the AWS implementations", () => {
    expectRejected({ ...HOSTED, REPOHIVE_LEDGER: "file:ledger.json" }, "REPOHIVE_LEDGER");
    expectRejected({ ...HOSTED, REPOHIVE_ORCHESTRATOR: "local" }, "REPOHIVE_ORCHESTRATOR");
  });
});

describe("parseAppConfig: every required setting", () => {
  const requiredLocal: AppConfigVariable[] = [
    "REPOHIVE_MODE",
    "REPOHIVE_SITE_ORIGIN",
    "REPOHIVE_DATA_DIR",
    "REPOHIVE_STORE",
    "REPOHIVE_LEDGER",
    "REPOHIVE_ORCHESTRATOR",
  ];
  for (const variable of requiredLocal) {
    it(`refuses a missing or blank ${variable}`, () => {
      expectRejected({ ...LOCAL, [variable]: undefined }, variable);
      expectRejected({ ...LOCAL, [variable]: "   " }, variable);
    });
  }

  it("refuses malformed values", () => {
    expectRejected({ ...LOCAL, REPOHIVE_MODE: "staging" }, "REPOHIVE_MODE");
    expectRejected({ ...LOCAL, REPOHIVE_SITE_ORIGIN: "http://localhost:3000/" }, "REPOHIVE_SITE_ORIGIN");
    expectRejected({ ...LOCAL, REPOHIVE_SITE_ORIGIN: "http://localhost:3000/app" }, "REPOHIVE_SITE_ORIGIN");
    expectRejected({ ...LOCAL, REPOHIVE_SITE_ORIGIN: "ftp://localhost" }, "REPOHIVE_SITE_ORIGIN");
    expectRejected({ ...LOCAL, REPOHIVE_SITE_ORIGIN: "localhost:3000" }, "REPOHIVE_SITE_ORIGIN");
    expectRejected({ ...LOCAL, REPOHIVE_STORE: "local:" }, "REPOHIVE_STORE");
    expectRejected({ ...LOCAL, REPOHIVE_STORE: "/tmp/store" }, "REPOHIVE_STORE");
    expectRejected({ ...LOCAL, REPOHIVE_LEDGER: "file:" }, "REPOHIVE_LEDGER");
    expectRejected({ ...LOCAL, REPOHIVE_ORCHESTRATOR: "sfn:not-an-arn" }, "REPOHIVE_ORCHESTRATOR");
  });

  it("never echoes a value in the error", () => {
    const secret = "ghp_do_not_print_me";
    const messages = [
      failure({ ...HOSTED, REPOHIVE_GITHUB_TOKEN: secret, REPOHIVE_CLIENT_IP_HEADER: secret + " x" }).message,
      failure({ ...LOCAL, REPOHIVE_MODE: secret }).message,
      failure({ ...LOCAL, REPOHIVE_STORE: secret }).message,
      failure({ ...LOCAL, REPOHIVE_SITE_ORIGIN: secret }).message,
    ];
    for (const message of messages) {
      expect(message).not.toContain(secret);
    }
  });
});

describe("no secret reaches the client bundle", () => {
  it("reads no NEXT_PUBLIC_ variable", () => {
    for (const variable of APP_CONFIG_VARIABLES) {
      expect(variable.startsWith("NEXT_PUBLIC_")).toBe(false);
    }
  });

  it("is not exposed through next.config's env", () => {
    const nextConfig = readFileSync(path.resolve(__dirname, "..", "..", "..", "next.config.ts"), "utf8");
    expect(/^\s*env\s*:/m.test(nextConfig)).toBe(false);
  });

  it("is not imported by any client component", () => {
    const src = path.resolve(__dirname, "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(name)) {
          const text = readFileSync(full, "utf8");
          const isClient = /^\s*["']use client["']/m.test(text);
          if (isClient && /from\s+["'](@\/lib\/hosting|[./]+lib\/hosting|\.\/config)/.test(text)) {
            offenders.push(path.relative(src, full));
          }
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});
