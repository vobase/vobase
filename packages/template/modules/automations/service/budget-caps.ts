// US-013 will populate setBudget. For US-002 this file exists to satisfy
// check:shape's TENANT_BUDGET_CAPS_WRITE_ALLOWED allowlist.
export async function setBudget(_orgId: string, _capUsd: number): Promise<void> {
  throw new Error('budget caps not implemented (US-013)')
}
