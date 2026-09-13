/**
 * The exit-code contract. Three codes, and no command may invent a fourth.
 *
 * The split already used by the wrappers this package replaces, promoted here
 * to a documented contract because CI will be written against it:
 *
 * | Code | Meaning |
 * |------|---------|
 * | 0 | success |
 * | 1 | the request ran and failed (a stage reported a structured error) |
 * | 2 | usage error: the command line could not be turned into a request |
 *
 * Code 2 covers an unknown command, an unknown option, a missing or repeated
 * value, an extra positional, a path argument that does not exist, and a
 * command that is not in this release. The test is whether anything was
 * attempted: if a stage ran and reported a structured error, that is 1, even
 * when the cause is a bad input file.
 */

/** Success. */
export const EXIT_OK = 0;

/** The request ran and failed. */
export const EXIT_FAILURE = 1;

/** The command line could not be turned into a request. */
export const EXIT_USAGE = 2;
