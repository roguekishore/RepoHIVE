/**
 * Source-root derivation (Fix 24 — Gap 2: source-root-scoped identity).
 *
 * A Java fully qualified name (FQN) is unique only *within one source root*
 * (one classpath), not across a whole repository. Multi-module repos legally
 * declare the same FQN in two roots (e.g. `src/main` vs `src/test`, or two Maven
 * modules), which — with FQN-only ids — produces duplicate node ids that the
 * grouping ingestor rejects. Scoping identity (and resolution) by source root
 * removes the collision.
 *
 * The source root is derived purely from the language's package↔directory
 * correspondence — no `pom.xml` / `build.gradle` parsing — so every build system
 * (Maven, Gradle, Bazel, flat) is handled uniformly:
 *
 * - Strip the package-as-directories + filename off the file's path; what
 *   remains is the source root.
 * - When the package does not correspond to the directory tail (legal but
 *   unusual), fall back to the **full relative path**, which is globally unique
 *   and so can never collide — this makes the scheme total.
 *
 * This module is pure and deterministic: {@link deriveSourceRoot} is a function
 * of its two string inputs only (no clock, counter, or randomness), so an id
 * built from its result re-derives identically across runs (R3.10, R3.11).
 */

/**
 * Derive the source root (classpath root) of a Java file.
 *
 * @param relativePath the file's root-relative, forward-slash POSIX path
 *   (as produced by the source collector), e.g.
 *   `src/main/java/com/example/Foo.java`.
 * @param packagePath the file's declared dotted package, or `""` for the
 *   default package.
 * @returns the source-root path (possibly `""` when the source root is the
 *   repository root), or — when the package does not correspond to the
 *   directory tail — the full `relativePath` as a globally-unique fallback.
 *
 * @example
 *   deriveSourceRoot("src/main/java/com/example/Foo.java", "com.example") === "src/main/java"
 *   deriveSourceRoot("src/test/java/com/example/Foo.java", "com.example") === "src/test/java"
 *   deriveSourceRoot("com/example/Foo.java",               "com.example") === ""     // root IS the source root
 *   deriveSourceRoot("loose/Bar.java",                     "")            === "loose" // default package: file's dir
 *   deriveSourceRoot("Baz.java",                           "")            === ""      // default package at root
 *   deriveSourceRoot("weird/place/Foo.java",               "com.example") === "weird/place/Foo.java" // degenerate
 */
export function deriveSourceRoot(relativePath: string, packagePath: string): string {
  const slash = relativePath.lastIndexOf("/");
  const dir = slash < 0 ? "" : relativePath.slice(0, slash);

  // Default package: there is no package-as-directory tail to strip, so the
  // file's own directory is the source root (R3.7 default-package case).
  if (packagePath.length === 0) {
    return dir;
  }

  const pkgAsPath = packagePath.split(".").join("/");

  // The file sits directly at the source root (the package spans the whole
  // directory), so the source root is the repository root.
  if (dir === pkgAsPath) {
    return "";
  }

  // The common case: the directory ends with the package path; strip it (plus
  // the joining slash) to leave the source root.
  if (dir.endsWith("/" + pkgAsPath)) {
    return dir.slice(0, dir.length - pkgAsPath.length - 1);
  }

  // Degenerate: the declared package does not correspond to the directory tail.
  // Use the full relative path as the scope — a path is globally unique, so
  // identity can never collide, which makes the scheme total over all inputs.
  return relativePath;
}
