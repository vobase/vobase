// Sole writer of `tenant_budget_caps`. Body lands in Slice D (US-013).
export async function setBudget(_orgId: string, _capUsd: number): Promise<void> {
  throw new Error('budget caps not implemented')
}
