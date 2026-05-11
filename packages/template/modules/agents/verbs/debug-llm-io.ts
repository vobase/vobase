// Admin-tier: payloads include the full system prompt + transcript with PII.
import { listLlmIo } from '@modules/agents/service/debug-readers'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

const SeqRangeSchema = z
  .string()
  .regex(/^\d+:\d+$/, '--seq must look like "N:M" (e.g. 130:160)')
  .optional()

export const debugLlmIoVerb = defineCliVerb({
  name: 'agents debug llm-io',
  description:
    'Dump the LLM I/O log (`harness.messages`) for a conversation: user cues, assistant tool calls with arguments, tool results, model + token + cost per row. Pass `--wakeId=<id>` to scope to one wake; `--seq=N:M` to slice; `--role` / `--tool` to filter; `--full` to include verbatim payloads (otherwise the `payload` field is replaced with a stub).',
  usage:
    'vobase agents debug llm-io [--conversationId=<id>] [--wakeId=<id>] [--seq=N:M] [--role=user|assistant|toolResult|system] [--tool=<name>] [--limit=30] [--full]',
  audience: 'admin',
  input: z
    .object({
      conversationId: z.string().min(1).optional(),
      wakeId: z.string().min(1).optional(),
      seq: SeqRangeSchema,
      role: z.enum(['user', 'assistant', 'toolResult', 'system']).optional(),
      tool: z.string().min(1).optional(),
      limit: z.number().int().positive().max(200).default(30),
      full: z.boolean().default(false),
    })
    .superRefine((val, ctx) => {
      if (!val.conversationId && !val.wakeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'one of --conversationId or --wakeId is required',
          path: ['conversationId'],
        })
      }
    }),
  body: async ({ input, ctx }) => {
    let seqFrom: number | undefined
    let seqTo: number | undefined
    if (input.seq) {
      const [from, to] = input.seq.split(':').map((s) => Number.parseInt(s, 10))
      seqFrom = from
      seqTo = to
    }
    try {
      const rows = await listLlmIo({
        organizationId: ctx.organizationId,
        conversationId: input.conversationId,
        wakeId: input.wakeId,
        seqFrom,
        seqTo,
        role: input.role,
        tool: input.tool,
        limit: input.limit,
        full: input.full,
      })
      return { ok: true as const, data: rows }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'list_llm_io_failed',
      }
    }
  },
  formatHint: 'table:cols=seq,role,model,tokensIn,tokensOut,cacheReadTokens,costUsd,toolName,preview',
})
