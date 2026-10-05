/**
 * Local orchestrator: detached child process running `runJob`.
 */
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { JobInput } from "@repohive/indexer";
import type { JobOrchestrator } from "./types";

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts");
const scriptPath = path.join(scriptsDir, "run-local-job.mjs");
// `--import` requires a `file://` URL for an absolute path on Windows (a bare
// drive letter like `D:\...` is read as an unsupported URL scheme).
const aliasLoaderPath = pathToFileURL(path.join(scriptsDir, "register-aliases.mjs")).href;

export function createLocalJobOrchestrator(): JobOrchestrator {
  return {
    async start(input: JobInput): Promise<void> {
      const child = spawn(
        process.execPath,
        ["--import", aliasLoaderPath, scriptPath],
        {
          detached: true,
          stdio: "ignore",
          env: {
            ...process.env,
            REPOHIVE_JOB_INPUT: JSON.stringify(input),
          },
        },
      );
      child.unref();
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("spawn", () => resolve());
      });
    },
  };
}
