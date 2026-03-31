/** Score result for a single eval item — dynamic scorer keys. */
export interface EvalItemScore {
  input: string;
  output: string;
  context: string[];
  scores: Record<string, number | null>;
}

/** Aggregate result of an eval run across all items. */
export interface EvalRunResult {
  items: EvalItemScore[];
  averages: Record<string, number | null>;
}
