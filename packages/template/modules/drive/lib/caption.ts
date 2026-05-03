/**
 * Caption derivation: pure, deterministic, runs on every extraction.
 *
 * Branches:
 *  - `binary-stub`: `"${humanMime} | ${humanSize}"`.
 *  - `extracted` (image, OCR summary present): prefers `ocrSummary` (raw OCR
 *    starts with noisy headers / page numbers, bad caption material).
 *  - `extracted` (text/document): `extractedText.slice(0, 120)` sentence-trimmed.
 */

import { humanBytes, humanMime } from './stub-markdown'

export type DriveCaptionKind = 'extracted' | 'binary-stub'

const MAX_LEN = 120

export interface DeriveCaptionInput {
  kind: DriveCaptionKind
  /** Body text used for `extracted`. */
  extractedText?: string
  mimeType: string
  sizeBytes: number
  /** Multimodal summary used for `extracted` images (preferred over slice). */
  ocrSummary?: string
}

/** Trim a slice to the nearest sentence boundary if one exists past 30 chars. */
function trimToSentence(slice: string): string {
  const m = /[.!?](\s|$)/u.exec(slice)
  if (m && m.index >= 30) return slice.slice(0, m.index + 1)
  return slice
}

function buildSizeCaption(mime: string, sizeBytes: number): string {
  return `${humanMime(mime)} — ${humanBytes(sizeBytes)}`
}

/** Derive a 120-char-or-less caption. Pure: no IO, deterministic. */
export function deriveCaption(input: DeriveCaptionInput): string {
  if (input.kind === 'binary-stub') {
    return buildSizeCaption(input.mimeType, input.sizeBytes)
  }
  // extracted
  if (input.mimeType.startsWith('image/') && input.ocrSummary && input.ocrSummary.trim().length > 0) {
    const summary = input.ocrSummary.trim()
    return summary.length <= MAX_LEN ? summary : trimToSentence(summary.slice(0, MAX_LEN))
  }
  const body = (input.extractedText ?? '').trim()
  if (body.length === 0) {
    // Empty extract, fall back to mime+size so the caption is never empty.
    return buildSizeCaption(input.mimeType, input.sizeBytes)
  }
  if (body.length <= MAX_LEN) return body
  return trimToSentence(body.slice(0, MAX_LEN))
}
