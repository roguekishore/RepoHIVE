/**
 * App configuration: every setting comes from an
 * environment variable and is validated once, at start-up. A missing or
 * invalid setting stops the app with an error that names the variable and
 * never echoes its value.
 *
 * | Variable                   | Value                                   | Rule                                  |
 * |----------------------------|-----------------------------------------|---------------------------------------|
 * | `REPOHIVE_MODE`            | `hosted` or `local`                     | required                              |
 * | `REPOHIVE_SITE_ORIGIN`     | an origin, e.g. `http://localhost:3000` | required; `https:` in hosted mode     |
 * | `REPOHIVE_DATA_DIR`        | directory for SQLite                    | required                              |
 * | `REPOHIVE_STORE`           | `local:<dir>` or `s3:<bucket>`          | required; `local:` in local mode      |
 * | `REPOHIVE_LEDGER`          | `file:<path>` or `dynamodb:<table>`     | required; `file:` local, `dynamodb:` hosted |
 * | `REPOHIVE_ORCHESTRATOR`    | `local` or `sfn:<state machine ARN>`    | required; `local` local, `sfn:` hosted |
 * | `REPOHIVE_GITHUB_TOKEN`    | the server-side GitHub token            | required in hosted mode               |
 * | `REPOHIVE_CLIENT_IP_HEADER`| the one trusted client-IP header        | required in hosted mode (R6.4)        |
 * | `AWS_REGION`               | from the platform                       | required with `s3:`, `dynamodb:`, `sfn:` |
 *
 * `REPOHIVE_STORE` and `REPOHIVE_LEDGER` use the indexer's syntax
 * (`packages/indexer/src/config.ts`), except that the app has no `memory`
 * ledger: the server, the background worker and the local orchestrator are
 * separate processes and must share one ledger.
 *
 * No variable here is `NEXT_PUBLIC_*`, so Next.js never
 * inlines one into the client bundle, and this module refuses to load in a
 * browser. It imports only Node built-ins, so the seed script can run it
 * directly with Node's type stripping.
 */
import { resolve } from "node:path";

if (typeof window !== "undefined") {
  throw new Error("lib/hosting/config is server-only");
}

export type AppMode = "hosted" | "local";

export type AppStoreConfig = { kind: "local"; directory: string } | { kind: "s3"; bucket: string };
export type AppLedgerConfig = { kind: "file"; path: string } | { kind: "dynamodb"; table: string };
export type OrchestratorConfig = { kind: "local" } | { kind: "sfn"; stateMachineArn: string };

export interface AppConfig {
  readonly mode: AppMode;
  /** Scheme, host and port, no trailing slash: what a browser sends as `Origin`. */
  readonly siteOrigin: string;
  /** Absolute. */
  readonly dataDirectory: string;
  readonly store: AppStoreConfig;
  readonly ledger: AppLedgerConfig;
  readonly orchestrator: OrchestratorConfig;
  readonly githubToken: string | undefined;
  /** Lowercase header name; `undefined` in local mode, which reads the socket address. */
  readonly clientIpHeader: string | undefined;
  readonly awsRegion: string | undefined;
}

/** Every variable this module reads, for documentation and the no-public-variable test. */
export const APP_CONFIG_VARIABLES = [
  "REPOHIVE_MODE",
  "REPOHIVE_SITE_ORIGIN",
  "REPOHIVE_DATA_DIR",
  "REPOHIVE_STORE",
  "REPOHIVE_LEDGER",
  "REPOHIVE_ORCHESTRATOR",
  "REPOHIVE_GITHUB_TOKEN",
  "REPOHIVE_CLIENT_IP_HEADER",
  "AWS_REGION",
] as const;

export type AppConfigVariable = (typeof APP_CONFIG_VARIABLES)[number];

export class ConfigError extends Error {
  readonly variable: AppConfigVariable;
  constructor(variable: AppConfigVariable, problem: string) {
    super(`${variable} ${problem}`);
    this.name = "ConfigError";
    this.variable = variable;
  }
}

type Env = Readonly<Record<string, string | undefined>>;

function optional(env: Env, name: AppConfigVariable): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function required(env: Env, name: AppConfigVariable): string {
  const value = optional(env, name);
  if (value === undefined) {
    throw new ConfigError(name, "is not set");
  }
  return value;
}

/** `prefix:<rest>` with a non-empty rest, or `undefined`. */
function after(text: string, prefix: string): string | undefined {
  return text.startsWith(prefix) && text.length > prefix.length ? text.slice(prefix.length) : undefined;
}

/** An RFC 9110 header field name (a token). */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Reads and validates the configuration. Relative paths resolve against `cwd`. */
export function parseAppConfig(env: Env, cwd: string = process.cwd()): AppConfig {
  const modeText = required(env, "REPOHIVE_MODE");
  if (modeText !== "hosted" && modeText !== "local") {
    throw new ConfigError("REPOHIVE_MODE", "must be hosted or local");
  }
  const mode: AppMode = modeText;
  const hosted = mode === "hosted";

  const originText = required(env, "REPOHIVE_SITE_ORIGIN");
  let siteOrigin: string;
  try {
    const url = new URL(originText);
    siteOrigin = url.origin;
    if ((url.protocol !== "http:" && url.protocol !== "https:") || siteOrigin !== originText) {
      throw new Error("not an origin");
    }
  } catch {
    throw new ConfigError("REPOHIVE_SITE_ORIGIN", "must be an origin such as https://example.com, with no path");
  }
  if (hosted && !siteOrigin.startsWith("https:")) {
    throw new ConfigError("REPOHIVE_SITE_ORIGIN", "must use https in hosted mode");
  }

  const dataDirectory = resolve(cwd, required(env, "REPOHIVE_DATA_DIR"));

  const storeText = required(env, "REPOHIVE_STORE");
  const localDir = after(storeText, "local:");
  const bucket = after(storeText, "s3:");
  let store: AppStoreConfig;
  if (localDir !== undefined) {
    store = { kind: "local", directory: resolve(cwd, localDir) };
  } else if (bucket !== undefined) {
    store = { kind: "s3", bucket };
  } else {
    throw new ConfigError("REPOHIVE_STORE", "must be local:<dir> or s3:<bucket>");
  }
  if (!hosted && store.kind !== "local") {
    throw new ConfigError("REPOHIVE_STORE", "must be local:<dir> in local mode");
  }

  const ledgerText = required(env, "REPOHIVE_LEDGER");
  const ledgerFile = after(ledgerText, "file:");
  const table = after(ledgerText, "dynamodb:");
  let ledger: AppLedgerConfig;
  if (ledgerFile !== undefined) {
    ledger = { kind: "file", path: resolve(cwd, ledgerFile) };
  } else if (table !== undefined) {
    ledger = { kind: "dynamodb", table };
  } else {
    throw new ConfigError("REPOHIVE_LEDGER", "must be file:<path> or dynamodb:<table>");
  }
  if (hosted && ledger.kind !== "dynamodb") {
    throw new ConfigError("REPOHIVE_LEDGER", "must be dynamodb:<table> in hosted mode");
  }
  if (!hosted && ledger.kind !== "file") {
    throw new ConfigError("REPOHIVE_LEDGER", "must be file:<path> in local mode");
  }

  const orchestratorText = required(env, "REPOHIVE_ORCHESTRATOR");
  const stateMachineArn = after(orchestratorText, "sfn:");
  let orchestrator: OrchestratorConfig;
  if (orchestratorText === "local") {
    orchestrator = { kind: "local" };
  } else if (stateMachineArn !== undefined && stateMachineArn.startsWith("arn:")) {
    orchestrator = { kind: "sfn", stateMachineArn };
  } else {
    throw new ConfigError("REPOHIVE_ORCHESTRATOR", "must be local or sfn:<state machine ARN>");
  }
  if (hosted && orchestrator.kind !== "sfn") {
    throw new ConfigError("REPOHIVE_ORCHESTRATOR", "must be sfn:<state machine ARN> in hosted mode");
  }
  if (!hosted && orchestrator.kind !== "local") {
    throw new ConfigError("REPOHIVE_ORCHESTRATOR", "must be local in local mode");
  }

  const githubToken = optional(env, "REPOHIVE_GITHUB_TOKEN");
  if (hosted && githubToken === undefined) {
    throw new ConfigError("REPOHIVE_GITHUB_TOKEN", "is not set");
  }

  let clientIpHeader: string | undefined;
  if (hosted) {
    const header = required(env, "REPOHIVE_CLIENT_IP_HEADER");
    if (!HEADER_NAME.test(header)) {
      throw new ConfigError("REPOHIVE_CLIENT_IP_HEADER", "must be a header name");
    }
    clientIpHeader = header.toLowerCase();
  }

  const awsRegion = optional(env, "AWS_REGION");
  if ((store.kind === "s3" || ledger.kind === "dynamodb" || orchestrator.kind === "sfn") && awsRegion === undefined) {
    throw new ConfigError("AWS_REGION", "is not set");
  }

  return { mode, siteOrigin, dataDirectory, store, ledger, orchestrator, githubToken, clientIpHeader, awsRegion };
}

let cached: AppConfig | undefined;

/** The process's configuration, parsed from `process.env` on first use. */
export function getAppConfig(): AppConfig {
  cached ??= parseAppConfig(process.env);
  return cached;
}
