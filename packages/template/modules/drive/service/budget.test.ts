/**
 * Unit tests for the per-org daily budget gate. Stubs the drizzle handle so
 * the test runs without Docker; verifies the gate trips on either cap.
 */

import { describe, expect, it } from 'bun:test'

import { EMBED_TOKEN_CAP_PER_DAY_PER_ORG, OCR_PAGE_CAP_PER_DAY_PER_ORG } from '../constants'
import { checkBudget, getTodayUsage } from './budget'

interface FakeUsageRow {
  llm_task: string
  call_count: number | null
  tokens_in: number | null
  tokens_out: number | null
}

function makeBudgetDb(initial: FakeUsageRow[]) {
  return { execute: () => Promise.resolve(initial.slice()) } as unknown
}

describe('drive/service/budget', () => {
  it('getTodayUsage rolls up OCR call_counts + embed tokens by llm_task', async () => {
    const db = makeBudgetDb([
      { llm_task: 'drive.caption.image', call_count: 5, tokens_in: 0, tokens_out: 0 },
      { llm_task: 'drive.extract.pdf', call_count: 12, tokens_in: 0, tokens_out: 0 },
      { llm_task: 'drive.embed', call_count: 3, tokens_in: 100, tokens_out: 50 },
      { llm_task: 'agent.turn', call_count: 99, tokens_in: 9999, tokens_out: 9999 },
    ])
    const usage = await getTodayUsage(db, 'org_test_0')
    expect(usage.ocrPages).toBe(17)
    expect(usage.embedTokens).toBe(150)
  })

  it('checkBudget passes when projected usage stays under both caps', async () => {
    const db = makeBudgetDb([])
    const result = await checkBudget(db, 'org_test_0', { ocrPages: 1, embedTokens: 1000 })
    expect(result.ok).toBe(true)
  })

  it('checkBudget rejects when projected OCR pages would exceed cap', async () => {
    const db = makeBudgetDb([
      { llm_task: 'drive.caption.image', call_count: OCR_PAGE_CAP_PER_DAY_PER_ORG, tokens_in: 0, tokens_out: 0 },
    ])
    const result = await checkBudget(db, 'org_test_0', { ocrPages: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('org_daily_budget_exceeded')
      expect(result.capExceeded).toBe('ocr_pages')
    }
  })

  it('checkBudget rejects when projected embed tokens would exceed cap', async () => {
    const db = makeBudgetDb([
      { llm_task: 'drive.embed', call_count: 1, tokens_in: EMBED_TOKEN_CAP_PER_DAY_PER_ORG, tokens_out: 0 },
    ])
    const result = await checkBudget(db, 'org_test_0', { embedTokens: 1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.capExceeded).toBe('embed_tokens')
    }
  })
})
