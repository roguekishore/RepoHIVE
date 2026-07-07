/**
 * SourceFileCollector (R2) — recursively discover the Java source files that
 * are eligible for parsing within a validated Project_Directory.
 *
 * Behavior (design: "SourceFileCollector (R2)"):
 * - Recursive walk to any depth (R2.1).
 * - Include a regular file **iff** its name ends with `.java` compared
 *   case-sensitively, so `.java` matches and `.JAVA` does not (R2.2).
 * - Skip directories, symbolic links, and non-`.java` regular files without
 *   raising an error; symbolic links are **not followed**, which prevents
 *   traversal cycles and enumeration non-determinism (R2.3).
 * - A subdirectory that cannot be read (EACCES / EPERM) is a fatal
 *   `directory-unreadable` error identifying that directory (R2.4).
 * - Zero `.java` files after a successful, readable walk is a fatal
 *   `no-java-files` error (R2.5).
 * - Results are returned sorted ascending byte-wise lexicographically by
 *   `relativePath`, so the order is independent of filesystem enumeration
 *   order (R2.6, R9.5).
 *
 * The filesystem read is injected via {@link CollectorDeps} so the
 * unreadable-subdirectory and symlink-skip branches can be simulated
 * deterministically on any platform (including Windows, where creating
 * symlinks or removing directory read access requires elevated privileges).
 */

import * as nodeFs from "node:fs/promises";
import * as path from "node:path";

import { makeError, ok, err, type ParseError, type Result } from "./errors.js";
import type { CollectedFile } from "./types.js";

/**
 * The validated project root the collector walks.
 *
 * TODO(task-3 seam): the orchestrator passes the `ValidatedPath` produced by
 * `input-validator.ts` (Task 3, developed concurrently). To avoid a cross-file
 * coupling while that task is in flight, the collector accepts only the minimal
 * structural shape it needs; the real `ValidatedPath` (`{ absolutePath }`)
 * satisfies this interface structurally.
 */
export interface CollectorRoot {
  /** Absolute, resolved path to the validated project directory. */
  absolutePath: string;
}

/** Minimal `fs.Dirent` surface the collector needs. */
export interface DirentLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

/**
 * Filesystem operations the collector depends on. Defaults to
 * `node:fs/promises`; tests inject a stub to simulate nested trees, symbolic
 * links, and permission-denied directories without touching the real
 * filesystem. `readdir` MUST use `withFileTypes` semantics so that entry types
 * (and, crucially, symbolic links) are reported without following links.
 */
export interface CollectorDeps {
  readdir(p: string): Promise<DirentLike[]>;
}

const defaultDeps: CollectorDeps = {
  readdir: (p) => nodeFs.readdir(p, { withFileTypes: true }),
};

/** The public SourceFileCollector interface (design: "SourceFileCollector (R2)"). */
export interface SourceFileCollector {
  collect(root: CollectorRoot): Promise<Result<CollectedFile[], ParseError>>;
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
 * Convert an absolute descendant path to a POSIX-normalized path relative to
 * the root: forward slashes, no leading separator. This is the only path
 * material that later enters a node id, so it must be OS-independent (R2.6,
 * R3.5).
 */
function toPosixRelative(rootAbsolute: string, entryAbsolute: string): string {
  const relative = path.relative(rootAbsolute, entryAbsolute);
  // `path.relative` yields platform separators (backslashes on Windows);
  // normalize every separator to a forward slash for canonical ordering.
  return relative.split(path.sep).join("/");
}

/**
 * Byte-wise lexicographic comparison of two strings by their UTF-8 encodings.
 *
 * JavaScript's default string comparison orders by UTF-16 code units, which
 * diverges from UTF-8 byte order for characters outside the Basic Multilingual
 * Plane. Comparing the UTF-8 byte sequences directly gives the canonical
 * ordering the contract requires (R2.6, R9.5).
 */
function compareByteWise(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Create a {@link SourceFileCollector} over the given filesystem dependencies.
 * Omit `deps` to use the real `node:fs/promises`.
 */
export function createSourceFileCollector(
  deps: CollectorDeps = defaultDeps,
): SourceFileCollector {
  return {
    async collect(root) {
      const rootAbsolute = root.absolutePath;
      const files: CollectedFile[] = [];

      // Recursive walk. Returns a fatal ParseError (unreadable directory) or
      // `null` on success; discovered `.java` files accumulate into `files`.
      const walk = async (absoluteDir: string): Promise<ParseError | null> => {
        let entries: DirentLike[];
        try {
          entries = await deps.readdir(absoluteDir);
        } catch (error) {
          // A directory that cannot be read (permissions or otherwise) is a
          // fatal error identifying the offending directory (R2.4).
          const code = errorCode(error);
          const detail =
            code === "EACCES" || code === "EPERM"
              ? "insufficient permissions"
              : "it could not be read";
          return makeError(
            "directory-unreadable",
            `Directory cannot be read (${detail}): ${absoluteDir}`,
            absoluteDir,
          );
        }

        for (const entry of entries) {
          // Skip symbolic links entirely and do NOT follow them (R2.3). This
          // check comes first so a symlink is skipped regardless of whether it
          // points at a directory or a `.java`-named file.
          if (entry.isSymbolicLink()) {
            continue;
          }

          const entryAbsolute = path.join(absoluteDir, entry.name);

          if (entry.isDirectory()) {
            const nestedError = await walk(entryAbsolute);
            if (nestedError !== null) {
              return nestedError;
            }
            continue;
          }

          if (entry.isFile()) {
            // Case-sensitive `.java` match: `.java` is included, `.JAVA` is not
            // (R2.2). Non-`.java` regular files are skipped without error (R2.3).
            if (entry.name.endsWith(".java")) {
              files.push({
                absolutePath: entryAbsolute,
                relativePath: toPosixRelative(rootAbsolute, entryAbsolute),
              });
            }
            continue;
          }

          // Any other entry kind (block device, FIFO, socket, ...) is skipped
          // without error (R2.3).
        }

        return null;
      };

      const walkError = await walk(rootAbsolute);
      if (walkError !== null) {
        return err([walkError]);
      }

      // A readable project with no `.java` files is a fatal error (R2.5).
      if (files.length === 0) {
        return err([
          makeError(
            "no-java-files",
            `No Java source files were found in the project directory: ${rootAbsolute}`,
            rootAbsolute,
          ),
        ]);
      }

      // Canonical order: ascending byte-wise lexicographic by relative path, so
      // the result is independent of filesystem enumeration order (R2.6, R9.5).
      files.sort((a, b) => compareByteWise(a.relativePath, b.relativePath));

      return ok(files);
    },
  };
}

/**
 * Convenience wrapper: collect Java source files under a validated root using
 * the real filesystem (or injected {@link CollectorDeps} for tests).
 */
export function collectSourceFiles(
  root: CollectorRoot,
  deps: CollectorDeps = defaultDeps,
): Promise<Result<CollectedFile[], ParseError>> {
  return createSourceFileCollector(deps).collect(root);
}
