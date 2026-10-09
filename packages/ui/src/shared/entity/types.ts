/**
 * Discriminated union of "entity kinds" addressable across the Repowise UI.
 * Every entity link, hover card, and context drawer entry uses this shape.
 *
 * Kept in `@repohive/ui` (presentational layer) so the hosted frontend
 * inherits the same vocabulary without a data-layer import.
 */
export type EntityKind = "file" | "symbol" | "decision" | "owner" | "commit";

export interface EntityRef {
  kind: EntityKind;
  /**
   * Stable id for the entity in its kind's own namespace:
   *  - file: relative path (e.g. "packages/core/src/.../graph.py")
   *  - symbol: fully-qualified symbol id (e.g. "module.path::name")
   *  - decision: decision record id
   *  - owner: email (preferred) or display name fallback
   *  - commit: 40-char SHA (or short SHA accepted)
   */
  id: string;
  /** Repo scope for entities that are repo-relative. */
  repoId?: string;
}
