/** Score result for a single eval item from one scorer. */
export interface EvalItemScore {
  input: string;
  output: string;
  context: string[];
  scores: {
    answerRelevancy: number | null;
    faithfulness: number | null;
  };
}

/** Aggregate result of an eval run across all items. */
export interface EvalRunResult {
  items: EvalItemScore[];
  averages: {
    answerRelevancy: number | null;
    faithfulness: number | null;
  };
}
