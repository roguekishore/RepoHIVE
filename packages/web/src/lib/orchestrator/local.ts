/**
 * Local orchestrator: detached child process running `runJob` (Requirement 8.6).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { JobInput } from "@repohive/indexer";
import type { JobOrchestrator } from "./types";

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "scripts",
  "run-local-job.mjs",
);

export function createLocalJobOrchestrator(): JobOrchestrator {
  return {
    async start(input: JobInput): Promise<void> {
      const child = spawn(
        process.execPath,
        [scriptPath],
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
