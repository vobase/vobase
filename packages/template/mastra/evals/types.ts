/** Prefix for DB-backed custom scorer IDs to avoid collisions with code scorers. */
const CUSTOM_SCORER_PREFIX = 'custom-';

/** Build a prefixed scorer ID from a DB row ID. */
export function customScorerId(dbId: string): string {
  return `${CUSTOM_SCORER_PREFIX}${dbId}`;
}

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
