/**
 * @repohive/views — the viewer's response bodies, built at index time.
 *
 * Each view is a pure function of a grouping output and equals the body the
 * matching `packages/web` route returns for the same index. The builders move
 * here from `packages/web/src/lib/repohive/`.
 *
 * Ecosystem package: depends on `@repohive/core` only, never on Next.js or
 * React. The engine packages must not import it.
 */
export {};
