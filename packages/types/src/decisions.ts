/**
 * Canonical decision-record types.
 *
 * Canonical source: engine `DecisionRecordResponse`. Some downstream backends
 * emit a leaner `DecisionEntry` shape that omits `repository_id` and types
 * `status`/`source` as bare `string` instead of literal unions — consumer
 * adapters fill defaults before passing data to components.
 */

export type DecisionStatus =
  | "proposed"
  | "active"
  | "deprecated"
  | "superseded";

type DecisionSource =
  | "git_archaeology"
  | "inline_marker"
  | "readme_mining"
  | "cli";

/** Derived granularity of a decision's blast area, narrowest first. */
type DecisionScope = "file" | "module" | "cross-module";

export interface DecisionRecord {
  id: string;
  repository_id: string;
  title: string;
  status: DecisionStatus;
  context: string;
  decision: string;
  rationale: string;
  alternatives: string[];
  consequences: string[];
  affected_files: string[];
  affected_modules: string[];
  tags: string[];
  source: DecisionSource;
  evidence_commits: string[];
  evidence_file: string | null;
  evidence_line: number | null;
  confidence: number;
  staleness_score: number;
  superseded_by: string | null;
  last_code_change: string | null;
  /** Trust tier of the decision's primary supporting evidence. Optional for back-compat. */
  verification?: DecisionVerification;
  /**
   * Derived granularity level. Optional for back-compat with older backends;
   * null when the record has no code linkage at all.
   */
  scope?: DecisionScope | null;
  created_at: string;
  updated_at: string;
  /** Number of evidence rows backing the record. List endpoint only. */
  evidence_count?: number | null;
  /** Top-ranked evidence row, slimmed for list rows. List endpoint only. */
  evidence_preview?: EvidencePreview | null;
}

/** The top-ranked evidence row, slimmed for decision list rows. */
interface EvidencePreview {
  source: string;
  source_quote: string;
  verification: DecisionVerification;
  evidence_file?: string | null;
  evidence_line?: number | null;
}

// ---------------------------------------------------------------------------
// Phase 4C: evidence / lineage / decision-graph
// ---------------------------------------------------------------------------

/**
 * Trust level of a decision's supporting evidence. `exact` = the source quote
 * was found verbatim in the cited file/commit; `fuzzy` = a near-match;
 * `unverified` = the quote could not be located (LLM-derived, treat with care).
 */
type DecisionVerification = "exact" | "fuzzy" | "unverified";
