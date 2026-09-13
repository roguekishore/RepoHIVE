/**
 * The CLI's two output streams, as an injectable pair.
 *
 * Every command takes a {@link CliIo} so `main(argv, io)` is testable without
 * spawning a process. The stream contract, documented in the package README and
 * binding on every command:
 *
 * - `log` is **stdout**: the primary result. Human prose when `--json` is
 *   absent, exactly one JSON document when it is present.
 * - `error` is **stderr**: diagnostics and human error prose. Never any part of
 *   the primary result, so `repohive ... --json | jq` is always well formed.
 *
 * With `--json` a command writes its document to stdout and nothing to stderr,
 * on success and on failure alike: the failure document IS the result.
 */

export interface CliIo {
  /** Write one line to stdout. */
  log(message: string): void;
  /** Write one line to stderr. */
  error(message: string): void;
}

/** The real streams. Default for every `main`, replaced in tests. */
export const consoleIo: CliIo = {
  // eslint-disable-next-line no-console
  log: (message) => console.log(message),
  // eslint-disable-next-line no-console
  error: (message) => console.error(message),
};
