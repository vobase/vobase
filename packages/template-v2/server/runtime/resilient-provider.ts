/**
 * Resilient provider wrapper — composes retry + error classification at the
 * provider boundary so every LlmTask inherits the same hardening for free.
 *
 * Retry ladder (simplified — Bifrost owns auth/billing/rate-limit in prod):
 *   transient            → up to 3 retries, exponential backoff + full jitter
 *   context_overflow |
 *   payload_too_large   → compressRequest() once → retry once → surface
 *   unknown             → no retry; log at error level; emit ErrorClassifiedEvent
 *
 * `ErrorClassifiedEvent` is emitted BEFORE each retry so drift detection
 * observers see every classification regardless of whether the call eventually
 * succeeds.
 */

import type { ErrorClassifiedEvent } from '@server/contracts/event'
import type { Logger } from '@server/contracts/observer'
import type { EventBus, LlmRequest } from '@server/contracts/plugin-context'
import type { LlmProvider, LlmStreamChunk } from '@server/contracts/provider-port'
import { classifyError } from './error-classifier'
import { compressRequest } from './preflight'

const BASE_DELAY_MS = 100
const MAX_TRANSIENT_RETRIES = 3
/** Hard cap on server-supplied Retry-After so a misconfigured gateway can't park a wake. */
const MAX_RETRY_AFTER_MS = 30_000

export interface ResilientProviderPolicy {
  events: EventBus
  logger: Logger
  /** Returns the current wake scope fields for emitted events. */
  getScope: () => { tenantId: string; conversationId: string; wakeId: string; turnIndex: number }
  /** Max retries for transient errors. Defaults to `MAX_TRANSIENT_RETRIES` (3). */
  maxTransientRetries?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jitteredDelay(attempt: number): number {
  return Math.random() * BASE_DELAY_MS * 2 ** attempt
}

function emitErrorClassified(
  policy: ResilientProviderPolicy,
  err: unknown,
  retryAttempt: number,
): ReturnType<typeof classifyError> {
  const classified = classifyError(err)
  const scope = policy.getScope()
  const evt: ErrorClassifiedEvent = {
    type: 'error_classified',
    ts: new Date(),
    wakeId: scope.wakeId,
    conversationId: scope.conversationId,
    tenantId: scope.tenantId,
    turnIndex: scope.turnIndex,
    reason: classified.reason,
    providerMessage: classified.providerMessage,
    httpStatus: classified.httpStatus,
    retryAttempt,
  }
  policy.events.publish(evt)
  return classified
}

async function drainStream(
  provider: LlmProvider,
  request: LlmRequest,
): Promise<{ chunks: LlmStreamChunk[]; error: unknown | null }> {
  const chunks: LlmStreamChunk[] = []
  try {
    for await (const chunk of provider.stream(request)) {
      chunks.push(chunk)
    }
    return { chunks, error: null }
  } catch (err) {
    return { chunks: [], error: err }
  }
}

async function resilientDrain(
  inner: LlmProvider,
  request: LlmRequest,
  policy: ResilientProviderPolicy,
): Promise<LlmStreamChunk[]> {
  const maxTransient = policy.maxTransientRetries ?? MAX_TRANSIENT_RETRIES
  let currentRequest = request
  let transientRetries = 0
  let compressionUsed = false

  while (true) {
    const { chunks, error } = await drainStream(inner, currentRequest)

    if (error === null) return chunks

    const classified = emitErrorClassified(policy, error, transientRetries)

    if (classified.reason === 'unknown') {
      policy.logger.error({ err: error, classified }, 'LLM provider unknown error — not retrying')
      throw error
    }

    if (classified.reason === 'context_overflow' || classified.reason === 'payload_too_large') {
      if (!compressionUsed) {
        compressionUsed = true
        currentRequest = compressRequest(currentRequest)
        continue
      }
      // Already tried compression — surface the error
      throw error
    }

    // transient
    if (transientRetries >= maxTransient) {
      policy.logger.error({ err: error, attempt: transientRetries }, 'LLM provider transient error — retries exhausted')
      throw error
    }
    // Honor server-supplied retry-after when present (capped); otherwise backoff with jitter.
    const delayMs =
      classified.retryAfterMs !== undefined
        ? Math.min(classified.retryAfterMs, MAX_RETRY_AFTER_MS)
        : jitteredDelay(transientRetries)
    await sleep(delayMs)
    transientRetries += 1
  }
}

/**
 * Wrap an `LlmProvider` with classified-error retry logic.
 * The returned provider satisfies the same `LlmProvider` interface.
 */
export function makeResilientProvider(inner: LlmProvider, policy: ResilientProviderPolicy): LlmProvider {
  return {
    name: inner.name,
    async *stream(request: LlmRequest): AsyncIterableIterator<LlmStreamChunk> {
      const chunks = await resilientDrain(inner, request, policy)
      for (const chunk of chunks) yield chunk
    },
  }
}
