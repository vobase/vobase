import { logger, notFound } from '@vobase/core'
import { and, eq, gt } from 'drizzle-orm'

import { automationPairingCodes, automationSessions } from '../schema'
import { getModuleDb, getModuleDeps } from './automation-deps'

/** API key TTL — 30 days. */
const API_KEY_EXPIRES_IN_S = 30 * 24 * 60 * 60

function generateCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const maxValid = 252 // largest multiple of 36 below 256 — avoids modulo bias
  const result: string[] = []
  while (result.length < 8) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    for (const b of bytes) {
      if (b < maxValid && result.length < 8) {
        result.push(chars[b % chars.length])
      }
    }
  }
  return result.join('')
}

/**
 * Generate a pairing code AND a better-auth API key in one step.
 * The API key is created now (while the user is authenticated) and
 * stored alongside the pairing code in the DB. On redemption, the
 * key is returned to the TamperMonkey script.
 */
export async function generatePairingCode(
  userId: string,
  headers: Headers | Record<string, string>,
): Promise<{ code: string; expiresAt: Date }> {
  const db = getModuleDb()
  const deps = getModuleDeps()
  const code = generateCode()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)

  const apiKeyResult = await deps.auth.createApiKey({
    headers,
    name: `automation-${code}`,
    expiresIn: API_KEY_EXPIRES_IN_S,
  })

  if (!apiKeyResult) {
    logger.error('[automation] Failed to create API key for pairing code')
    throw new Error('Failed to create API key for automation session')
  }

  await db.insert(automationPairingCodes).values({
    code,
    userId,
    status: 'active',
    expiresAt,
    apiKey: apiKeyResult.key,
    apiKeyId: apiKeyResult.id,
  })

  logger.info(`[automation] Pairing code generated for user ${userId}, expires ${expiresAt.toISOString()}`)
  return { code, expiresAt }
}

export async function redeemPairingCode(
  code: string,
  browserInfo: Record<string, unknown>,
): Promise<{ sessionId: string; apiKey: string }> {
  const db = getModuleDb()
  const now = new Date()

  // Atomic claim: UPDATE ... WHERE status = 'active' prevents double-redemption
  const [pairingCode] = await db
    .update(automationPairingCodes)
    .set({ status: 'used', usedAt: now })
    .where(
      and(
        eq(automationPairingCodes.code, code),
        eq(automationPairingCodes.status, 'active'),
        gt(automationPairingCodes.expiresAt, now),
      ),
    )
    .returning()

  if (!pairingCode) {
    throw notFound('Invalid or expired pairing code')
  }

  if (!pairingCode.apiKey || !pairingCode.apiKeyId) {
    throw new Error('Pairing code missing API key data — generate a new code')
  }

  const { apiKey, apiKeyId } = pairingCode

  const [session] = await db
    .insert(automationSessions)
    .values({
      userId: pairingCode.userId,
      status: 'active',
      browserInfo,
      apiKeyId,
      pairedAt: now,
      lastHeartbeat: now,
    })
    .returning()

  if (!session) {
    throw new Error('Failed to create automation session')
  }

  // Link session back to pairing code and clear the stored key
  await db
    .update(automationPairingCodes)
    .set({ sessionId: session.id, apiKey: null })
    .where(eq(automationPairingCodes.id, pairingCode.id))

  logger.info(`[automation] Pairing code redeemed — session ${session.id} created for user ${pairingCode.userId}`)
  return { sessionId: session.id, apiKey }
}
