/**
 * Path resolution for a real command.
 *
 * Relative arguments resolve against `process.cwd()` and nothing else.
 *
 * The wrappers this package replaces resolved against `INIT_CWD`, because both
 * were reached through `npm run --workspace`, which changes the process working
 * directory to the package directory and would otherwise break a relative
 * argument. `INIT_CWD` is an npm-script artifact: it is unset when a `bin` shim
 * is invoked directly, and when it is set by an unrelated npm script it points
 * somewhere the user never typed. A packaged binary must use the working
 * directory of the process, which is what the user's shell was in.
 */

import { isAbsolute, resolve } from "node:path";

/** Resolve a user-supplied path against the process working directory. */
export function resolveFromCwd(inputPath: string): string {
  if (isAbsolute(inputPath)) {
    return inputPath;
  }
  return resolve(process.cwd(), inputPath);
}
