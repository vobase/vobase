/**
 * Three-layer tool-result byte budget:
 *   L1 — preview length shown to the model.
 *   L2 — individual result size that triggers spill-to-file.
 *   L3 — per-turn aggregate ceiling; once exceeded, every subsequent result is force-spilled.
 */

export const L1_PREVIEW_BYTES = 4_000
export const L2_SPILL_BYTES = 100_000
export const L3_CEILING_BYTES = 200_000

export class TurnBudget {
  private consumed = 0

  reset(): void {
    this.consumed = 0
  }

  record(bytes: number): void {
    this.consumed += bytes
  }

  isExceeded(): boolean {
    return this.consumed > L3_CEILING_BYTES
  }

  wouldExceed(bytes: number): boolean {
    return this.consumed + bytes > L3_CEILING_BYTES
  }
}
