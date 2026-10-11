/**
 * The one source-selection policy, shared by the disk collector and the
 * in-memory source.
 *
 * A Java source file is selected iff, for its root-relative POSIX path:
 * - no directory segment is in the exclusion set (segment-exact, case-sensitive,
 *   and the file's own name is never matched);
 * - its name ends with `.java`, case-sensitively (`.JAVA` is not Java);
 * - the path can be carried inside a node identifier.
 *
 * Selected paths are then ordered byte-wise over UTF-8 (`compareCanonical`).
 *
 * The disk walk applies the directory rule while descending, so an excluded
 * subtree is never read; it calls the same predicates defined here for the other
 * two rules. A memory source applies {@link classifySourcePath} to each entry.
 * Neither side has a private copy of any rule, which is what makes the same tree
 * produce the same selection whichever way it arrives.
 */

/**
 * Default directory-name segments excluded from collection (Fix 16 - Gap 19).
 * These hold machine-generated or vendored `.java` that is not authored source;
 * indexing them inflates every count and (per Gap 2) manufactures duplicate
 * FQNs. Matching is segment-exact and case-sensitive, so a real package named
 * `building` is safe.
 */
export const DEFAULT_EXCLUDED_SEGMENTS: readonly string[] = [
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "target",
  "build",
  "out",
  "bin",
  ".gradle",
  ".mvn",
  ".idea",
  "generated-sources",
  "generated",
];

/**
 * Whether a root-relative path can be carried inside a node identifier.
 *
 * These are the same predicates `ids.ts`'s `assertRootRelativePosixPath` checks;
 * they exist here as well because discovery is the one place where a path is
 * still a first-class thing with an error channel. Deciding here leaves the
 * `ids.ts` guards as the genuinely-unreachable internal assertions they were
 * written to be, instead of the only place a legal-but-unrepresentable filename
 * could surface - as a raw stack trace (R9.4, R10.2).
 */
export function isRepresentablePosixRelative(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    !relativePath.includes("\\") &&
    !relativePath.startsWith("/") &&
    !/^[A-Za-z]:/.test(relativePath)
  );
}

/** Case-sensitive `.java` match: `.java` is included, `.JAVA` is not (R2.2). */
export function hasJavaExtension(fileName: string): boolean {
  return fileName.endsWith(".java");
}

/** The exclusion set in effect: the caller's, or the defaults when omitted. */
export function resolveExcludedSegments(
  excludedSegments: ReadonlySet<string> | undefined,
): ReadonlySet<string> {
  return excludedSegments ?? new Set(DEFAULT_EXCLUDED_SEGMENTS);
}

/** What the selection policy decides about one root-relative path. */
export type SourcePathClass =
  /** Selected for parsing. */
  | "selected"
  /** Inside an excluded directory; dropped silently. */
  | "excluded"
  /** Not a `.java` file; dropped silently. */
  | "not-java"
  /** A `.java` file whose path cannot become a node id; the disk walk reports it as `path-unsupported`. */
  | "unsupported";

/**
 * Classify one root-relative POSIX path. The rules apply in the order the disk
 * walk meets them: an excluded directory is never entered, so a path under one is
 * `excluded` whatever else is true of it; a non-`.java` file is skipped before its
 * path is examined; only then is representability checked.
 */
export function classifySourcePath(
  relativePath: string,
  excludedSegments: ReadonlySet<string>,
): SourcePathClass {
  const segments = relativePath.split("/");
  const fileName = segments[segments.length - 1] as string;
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (excludedSegments.has(segments[i] as string)) {
      return "excluded";
    }
  }
  if (!hasJavaExtension(fileName)) {
    return "not-java";
  }
  return isRepresentablePosixRelative(relativePath) ? "selected" : "unsupported";
}

/** Options for {@link isSelectedSourcePath}: the same exclusion option the engine takes. */
export interface SourceSelectionOptions {
  /**
   * Directory-name segments to exclude. Omitted → {@link DEFAULT_EXCLUDED_SEGMENTS};
   * an empty set includes everything.
   */
  excludedSegments?: ReadonlySet<string>;
}

/**
 * Whether the policy selects this root-relative POSIX path. Pure: no filesystem,
 * no state. A caller holding a streamed archive can drop non-selected entries
 * with it before handing the rest over as a memory source, so it never buffers
 * bytes the engine would discard.
 *
 * It answers `false` for an `unsupported` path as well, which the disk walk
 * would instead report as a `path-unsupported` error; a caller that wants that
 * report keeps such entries and lets the engine produce it.
 */
export function isSelectedSourcePath(
  relativePath: string,
  options: SourceSelectionOptions = {},
): boolean {
  return classifySourcePath(relativePath, resolveExcludedSegments(options.excludedSegments)) === "selected";
}
