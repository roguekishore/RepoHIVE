

// ---------------------------------------------------------------------------
// Heritage (extends / implements / trait_impl / mixin / overrides)
// ---------------------------------------------------------------------------

/**
 * Heritage relation kinds. Mirrors the engine's edge_type values for
 * heritage edges in the symbol graph plus the raw AST-level "mixin" kind.
 */
export type HeritageKind =
  | "extends"
  | "implements"
  | "trait_impl"
  | "mixin"
  | "method_overrides"
  | "method_implements";

/**
 * A single resolved heritage edge.
 *
 * `child_id` and `parent_id` are symbol-graph node IDs (e.g.
 * `src/app.py::MyClass`). `confidence` is present for resolved relations
 * (0.0–1.0) and absent for raw, unresolved entries lifted directly out of
 * `parsed_files.json::heritage` (in which case only `child_name`,
 * `parent_name`, `kind`, and `line` are meaningful).
 */
export interface HeritageRelation {
  child_id?: string;
  parent_id?: string;
  child_name: string;
  parent_name: string;
  kind: HeritageKind;
  line: number;
  confidence?: number;
}

/**
 * Heritage view for a single symbol — both directions of the relation.
 *
 * `parents` are the relations where this symbol is the child (i.e. what it
 * extends/implements). `children` are the relations where this symbol is the
 * parent (i.e. what extends/implements it).
 */
export interface SymbolHeritage {
  symbol_id: string;
  parents: HeritageRelation[];
  children: HeritageRelation[];
}
