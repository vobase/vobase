/**
 * Threat-scan signature — ported from hermes. Patterns land in Phase 2+;
 * spec §11 is the reference list. Phase 1 ships a stub that returns `{ok:true}` always.
 */

export type ThreatCategory = 'invisible_unicode' | 'prompt_injection' | 'exfiltration' | 'secret_leak'

export interface ThreatMatch {
  category: ThreatCategory
  patternId: string
  /** Byte range in the scanned text. */
  start: number
  end: number
  sample: string
}

export type ThreatScanResult =
  | { ok: true; report?: { scannedAt: Date; byteCount: number } }
  | {
      ok: false
      matches: ThreatMatch[]
      blockReason: string
      scannedAt: Date
    }

export interface ThreatScanOptions {
  categories?: ThreatCategory[]
  /** When false, invisible-unicode normalization is skipped. Default true. */
  normalize?: boolean
}

export interface ThreatScanner {
  scan(text: string, opts?: ThreatScanOptions): Promise<ThreatScanResult>
}
