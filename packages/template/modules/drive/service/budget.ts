/**
 * Per-org daily budget gate for the drive extraction pipeline.
 *
 * Why: caps OCR + embedding spend per UTC day per org so a single bad input
 * can't torch a tenant's API bill. Counters live in `harness.tenant_cost_daily`
 * (`@vobase/core`) — the sole writer is `recordCostUsage`. This file owns
 * only the read-side rollup + gate.
 */

import { sql } from 'drizzle-orm'

import type { LlmTask } from '~/runtime'
import { EMBED_TOKEN_CAP_PER_DAY_PER_ORG, OCR_PAGE_CAP_PER_DAY_PER_ORG } from '../constants'

type BudgetDb = {
  execute: <T>(q: unknown) => Promise<T[]>
}

const OCR_TASKS: readonly LlmTask[] = ['drive.caption.image', 'drive.caption.video', 'drive.extract.pdf']

/** Sentinel `llm_task` for embedding spend so it rolls up under one row per day. */
export const EMBED_TASK = 'drive.embed' as const

export interface DriveBudgetUsage {
  ocrPages: number
  embedTokens: number
}

export async function getTodayUsage(db: unknown, organizationId: string): Promise<DriveBudgetUsage> {
  const d = db as BudgetDb
  const rows = await d.execute<{
    llm_task: string
    call_count: number | null
    tokens_in: number | null
    tokens_out: number | null
  }>(
    sql`SELECT llm_task, call_count, tokens_in, tokens_out
        FROM harness.tenant_cost_daily
        WHERE organization_id = ${organizationId}
          AND date = CURRENT_DATE`,
  )
  let ocrPages = 0
  let embedTokens = 0
  for (const r of rows) {
    if (OCR_TASKS.includes(r.llm_task as LlmTask)) ocrPages += r.call_count ?? 0
    if (r.llm_task === EMBED_TASK) embedTokens += (r.tokens_in ?? 0) + (r.tokens_out ?? 0)
  }
  return { ocrPages, embedTokens }
}

export type BudgetCheckResult =
  | { ok: true }
  | { ok: false; reason: 'org_daily_budget_exceeded'; capExceeded: 'ocr_pages' | 'embed_tokens' }

export async function checkBudget(
  db: unknown,
  organizationId: string,
  projected: { ocrPages?: number; embedTokens?: number },
): Promise<BudgetCheckResult> {
  const usage = await getTodayUsage(db, organizationId)
  const projectedOcr = projected.ocrPages ?? 0
  const projectedEmbed = projected.embedTokens ?? 0
  if (usage.ocrPages + projectedOcr > OCR_PAGE_CAP_PER_DAY_PER_ORG) {
    return { ok: false, reason: 'org_daily_budget_exceeded', capExceeded: 'ocr_pages' }
  }
  if (usage.embedTokens + projectedEmbed > EMBED_TOKEN_CAP_PER_DAY_PER_ORG) {
    return { ok: false, reason: 'org_daily_budget_exceeded', capExceeded: 'embed_tokens' }
  }
  return { ok: true }
}
