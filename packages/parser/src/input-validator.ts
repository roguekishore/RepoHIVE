/**
 * InputValidator (R1) — validate the Project_Directory before any work begins.
 *
 * The validator fails fast: it performs every check (existence, is-directory,
 * readability) and, on the first failure, returns exactly one {@link ParseError}
 * with the offending path (R1.7). No source-file collection happens until the
 * path is fully validated (R1.2).
 *
 * Behavior (design: "InputValidator (R1)"):
 * - null / empty / whitespace-only path            → `no-path-provided`      (R1.3)
 * - `fs.stat` reports the path is missing (ENOENT)  → `path-not-found`        (R1.4)
 * - path exists but is not a directory              → `path-not-directory`    (R1.5)
 * - directory cannot be opened (EACCES / EPERM)     → `directory-unreadable`  (R1.6)
 * - otherwise                                       → accept (R1.1)
 *
 * The filesystem operations are injected via {@link ValidatorDeps} so the
 * permission-denied branch can be simulated deterministically on any platform
 * (including Windows, where POSIX `chmod` does not reliably remove read access).
 */

import * as nodeFs from "node:fs/promises";
import * as path from "node:path";

import { makeError, ok, err, type ParseError, type Result } from "./errors.js";

/** A path that has passed all of {@link InputValidator} validation. */
export interface ValidatedPath {
  /** Absolute, resolved path to the validated project directory. */
  absolutePath: string;
}

/** Minimal `fs.Stats` surface the validator needs. */
export interface StatLike {
  isDirectory(): boolean;
}

/** Minimal `fs.Dir` surface the validator needs for its readability probe. */
export interface DirLike {
  read(): Promise<unknown>;
  close(): Promise<void>;
}

/**
 * Filesystem operations the validator depends on. Defaults to
 * `node:fs/promises`; tests inject a stub to simulate missing paths, files, and
 * permission-denied directories without touching the real filesystem.
 */
export interface ValidatorDeps {
  stat(p: string): Promise<StatLike>;
  opendir(p: string): Promise<DirLike>;
}

const defaultDeps: ValidatorDeps = {
  stat: (p) => nodeFs.stat(p),
  opendir: (p) => nodeFs.opendir(p),
};

/** The public InputValidator interface (design: "InputValidator (R1)"). */
export interface InputValidator {
  validate(
    projectDirectory: string | null | undefined,
  ): Promise<Result<ValidatedPath, ParseError>>;
}

/** Extract a filesystem error code (`ENOENT`, `EACCES`, ...) if present. */
function errorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

/**
 * Create an {@link InputValidator} over the given filesystem dependencies.
 * Omit `deps` to use the real `node:fs/promises`.
 */
export function createInputValidator(
  deps: ValidatorDeps = defaultDeps,
): InputValidator {
  return {
    async validate(projectDirectory) {
      // R1.3 — reject null / undefined / empty / whitespace-only input up front,
      // before touching the filesystem.
      if (
        projectDirectory === null ||
        projectDirectory === undefined ||
        projectDirectory.trim().length === 0
      ) {
        return err([
          makeError(
            "no-path-provided",
            "No project directory path was provided.",
          ),
        ]);
      }

      const providedPath = projectDirectory;
      const absolutePath = path.resolve(providedPath);

      // Existence + type check (R1.4, R1.5).
      let stats: StatLike;
      try {
        stats = await deps.stat(absolutePath);
      } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR") {
          return err([
            makeError(
              "path-not-found",
              `Project directory path does not exist: ${providedPath}`,
              providedPath,
            ),
          ]);
        }
        if (code === "EACCES" || code === "EPERM") {
          // The path (or a component of it) cannot be accessed due to
          // insufficient permissions (R1.6).
          return err([
            makeError(
              "directory-unreadable",
              `Project directory cannot be read due to insufficient permissions: ${providedPath}`,
              providedPath,
            ),
          ]);
        }
        // Any other stat failure is treated as the path being unusable.
        return err([
          makeError(
            "path-not-found",
            `Project directory path could not be accessed: ${providedPath}`,
            providedPath,
          ),
        ]);
      }

      // R1.5 — the path exists but must refer to a directory.
      if (!stats.isDirectory()) {
        return err([
          makeError(
            "path-not-directory",
            `Project directory path is not a directory: ${providedPath}`,
            providedPath,
          ),
        ]);
      }

      // R1.6 — probe readability by opening the directory (and reading one
      // entry). Insufficient permissions surface as EACCES / EPERM.
      try {
        const dir = await deps.opendir(absolutePath);
        try {
          await dir.read();
        } finally {
          await dir.close();
        }
      } catch (error) {
        const code = errorCode(error);
        if (code === "EACCES" || code === "EPERM") {
          return err([
            makeError(
              "directory-unreadable",
              `Project directory cannot be read due to insufficient permissions: ${providedPath}`,
              providedPath,
            ),
          ]);
        }
        return err([
          makeError(
            "directory-unreadable",
            `Project directory could not be opened: ${providedPath}`,
            providedPath,
          ),
        ]);
      }

      // R1.1 — path exists, is a directory, and is readable.
      return ok({ absolutePath });
    },
  };
}

/**
 * Convenience wrapper: validate a project directory using the real filesystem
 * (or injected {@link ValidatorDeps} for tests).
 */
export function validateInput(
  projectDirectory: string | null | undefined,
  deps: ValidatorDeps = defaultDeps,
): Promise<Result<ValidatedPath, ParseError>> {
  return createInputValidator(deps).validate(projectDirectory);
}
