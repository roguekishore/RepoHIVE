#!/usr/bin/env node
/**
 * The `bin` entry point for `repohive`.
 *
 * The shebang and the unconditional call below are what make this file a real
 * command rather than a demo script. The wrappers this package replaces ended
 * with `if (process.argv[1]?.endsWith("group-cli.js"))`, a guard that would
 * never fire under a `bin` shim: npm installs a shim whose path is
 * `node_modules/.bin/repohive`, so `process.argv[1]` is the shim, not this
 * module, and the guarded `main` call would silently do nothing.
 *
 * `main` stays exported from `main.ts` and takes its argv and streams as
 * parameters, so tests call it directly and this file is the only module that
 * touches `process`.
 */

import { EXIT_FAILURE } from "./exit-codes.js";
import { consoleIo } from "./io.js";
import { main } from "./main.js";

main(process.argv.slice(2), consoleIo).then(
  (code) => {
    process.exitCode = code;
  },
  (cause: unknown) => {
    // A rejection must not surface as a raw stack trace with an exit code that
    // does not reliably signal failure. Render it and exit non-zero.
    consoleIo.error(
      `repohive: internal error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    process.exitCode = EXIT_FAILURE;
  },
);
