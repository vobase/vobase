import { getCtx, logger, unauthorized, validation } from '@vobase/core'
import { Hono } from 'hono'
import { z } from 'zod'

import { generatePairingCode, redeemPairingCode } from '../lib/pairing'

// Simple in-memory rate limiter for redeem attempts (per IP)
const redeemAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_REDEEM_ATTEMPTS = 5
const REDEEM_WINDOW_MS = 5 * 60 * 1000

function checkRedeemRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = redeemAttempts.get(ip)
  if (!entry || entry.resetAt < now) {
    redeemAttempts.set(ip, { count: 1, resetAt: now + REDEEM_WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= MAX_REDEEM_ATTEMPTS
}

// Sweep expired entries every 60s
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of redeemAttempts) {
    if (entry.resetAt < now) redeemAttempts.delete(ip)
  }
}, 60_000).unref()

export const pairingHandlers = new Hono()

  // ─── Generate pairing code (authenticated) ────────────────────────
  .post('/generate', async (c) => {
    const ctx = getCtx(c)
    if (!ctx.user) throw unauthorized()

    const result = await generatePairingCode(ctx.user.id, c.req.raw.headers)

    return c.json(result)
  })

  // ─── Redeem pairing code (public) ─────────────────────────────────
  .post('/redeem', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'unknown'

    if (!checkRedeemRateLimit(ip)) {
      logger.warn(`[automation] Rate limit exceeded for pairing redeem from ${ip}`)
      return c.json({ error: 'Too many attempts. Try again later.' }, 429)
    }

    const redeemSchema = z.object({
      code: z.string().length(8),
      browserInfo: z.record(z.string(), z.unknown()),
    })

    const parsed = redeemSchema.safeParse(await c.req.json())
    if (!parsed.success) {
      throw validation(parsed.error.flatten().fieldErrors)
    }

    const { code, browserInfo } = parsed.data
    const result = await redeemPairingCode(code, browserInfo)
    return c.json(result)
  })
