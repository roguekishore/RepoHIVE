/**
 * Runs the HTTP end-to-end script (long-running).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { describe, it } from "vitest";

const webRoot = path.resolve(__dirname, "..", "..", "..");
const script = path.join(webRoot, "scripts", "e2e.mjs");

describe("HTTP e2e", () => {
  it(
    "passes the local flow script",
    () =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [script], {
          cwd: webRoot,
          stdio: "inherit",
          env: process.env,
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`e2e exited ${code}`));
          }
        });
      }),
    900_000,
  );
});
