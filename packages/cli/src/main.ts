/**
 * Subcommand dispatch for the `repohive` binary.
 *
 * The first argument selects a command, exactly as `git commit` and
 * `docker build` work; npm's own subcommands cannot be extended, so
 * `npm repohive index` is not and never will be a valid invocation. The
 * supported forms are `repohive index .` after a global install and
 * `npx repohive index .` without one.
 *
 * `main(argv, io)` takes its arguments and its streams as parameters and
 * returns an exit code, so the whole surface is testable without spawning a
 * process. `cli.ts` is the only place that touches `process`.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_OK, EXIT_USAGE } from "./exit-codes.js";
import { GROUP_SUMMARY, main as runGroup } from "./group.js";
import { INDEX_SUMMARY, main as runIndex } from "./index-command.js";
import { consoleIo, type CliIo } from "./io.js";
import { emitJson, usageFailureDocument, wantsJson, type CommandName } from "./json.js";
import { PARSE_SUMMARY, main as runParse } from "./parse.js";

/** One dispatchable command. `run` returns the process exit code. */
export interface CliCommand {
  name: CommandName;
  /** One line for the command list in the top-level usage text. */
  summary: string;
  run(argv: readonly string[], io: CliIo): Promise<number> | number;
}

/**
 * The shipped commands, in the order the usage text lists them.
 *
 * `view` is deliberately absent: it is a decided, final command name whose
 * implementation is Stage 2. Dispatch recognizes it anyway (see
 * {@link VIEW_DEFERRED_MESSAGE}) because answering "unknown command: view"
 * would wrongly suggest the name is undecided, and would send someone looking
 * for a different spelling of a command that is simply not here yet.
 */
const COMMANDS: readonly CliCommand[] = [
  { name: "index", summary: INDEX_SUMMARY, run: runIndex },
  { name: "parse", summary: PARSE_SUMMARY, run: runParse },
  { name: "group", summary: GROUP_SUMMARY, run: runGroup },
];

/** What `repohive view` says until the viewer ships. */
export const VIEW_DEFERRED_MESSAGE =
  "the view command ships in a later release; `repohive index <dir> --json` is the Stage 1 surface";

function commandList(): string {
  const entries = COMMANDS.map((command) => `  ${command.name.padEnd(15)} ${command.summary}`);
  entries.push(`  ${"view".padEnd(15)} not in this release`);
  return entries.join("\n");
}

function usage(): string {
  return `RepoHIVE — repository hierarchical indexing

usage: repohive <command> [options]

commands:
${commandList()}

global options:
  --version                       print the version and exit
  --help, -h                      show this message
  --json                          machine-readable output on stdout

exit codes:
  0  success
  1  the request ran and failed
  2  usage error (unknown command or option, missing or nonexistent path)

run \`repohive <command> --help\` for a command's own options`;
}

/**
 * This package's version, read from its own manifest.
 *
 * Read rather than compiled in so the number cannot drift from the manifest
 * npm publishes. `dist/main.js` sits one level under the package root, and a
 * published tarball always carries `package.json` beside `dist/`, so the same
 * relative path works installed and in the repository.
 */
export function readVersion(): string {
  try {
    const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
      const version = (parsed as { version: unknown }).version;
      if (typeof version === "string") {
        return version;
      }
    }
  } catch {
    // Fall through: an unreadable manifest must not stop the binary running.
  }
  return "0.0.0";
}

/** Report a usage error in whichever form the caller asked for. */
function usageError(
  io: CliIo,
  argv: readonly string[],
  command: CommandName | null,
  message: string,
): number {
  if (wantsJson(argv)) {
    emitJson(io, usageFailureDocument(command, message));
    return EXIT_USAGE;
  }
  io.error(`repohive: ${message}`);
  io.error(usage());
  return EXIT_USAGE;
}

/**
 * Run the CLI. Returns the process exit code.
 *
 * `--version` and `--help` are the one exception to the stdout contract: they
 * print prose to stdout even under `--json`, because they answer a question
 * about the tool rather than producing a result.
 */
export async function main(argv: readonly string[], io: CliIo = consoleIo): Promise<number> {
  const token = argv[0];

  if (token === undefined) {
    return usageError(io, argv, null, "a command is required");
  }
  if (token === "--version") {
    io.log(readVersion());
    return EXIT_OK;
  }
  if (token === "--help" || token === "-h") {
    io.log(usage());
    return EXIT_OK;
  }
  if (token === "view") {
    return usageError(io, argv, "view", VIEW_DEFERRED_MESSAGE);
  }

  const command = COMMANDS.find((candidate) => candidate.name === token);
  if (command !== undefined) {
    return await command.run(argv.slice(1), io);
  }

  if (token.startsWith("-")) {
    return usageError(io, argv, null, `unknown option: ${token}`);
  }
  return usageError(io, argv, null, `unknown command: ${token}`);
}
