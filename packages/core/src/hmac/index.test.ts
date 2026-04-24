import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import type { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'

import type { VobaseDb } from '../db/client'
import type { Scheduler } from '../jobs/queue'
import { createTestPGlite } from '../test-helpers'
import { checkAndRecordWebhook, createWebhookRoutes, signHmac, verifyHmacSignature, type WebhookConfig } from '.'

let db: VobaseDb
let pglite: PGlite

beforeAll(async () => {
  pglite = await createTestPGlite()
  await pglite.exec(`
    CREATE TABLE "infra"."webhook_dedup" (
      id TEXT NOT NULL,
      source TEXT NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (id, source)
    )
  `)
  db = drizzle({ client: pglite })
})

describe('WebhookConfig', () => {
  test('type is correctly shaped with required and optional fields', () => {
    const config: WebhookConfig = {
      path: '/webhooks/stripe',
      secret: 'whsec_test123',
      handler: 'system:processWebhook',
    }
    expect(config.path).toBe('/webhooks/stripe')
    expect(config.secret).toBe('whsec_test123')
    expect(config.handler).toBe('system:processWebhook')
    expect(config.signatureHeader).toBeUndefined()
    expect(config.dedup).toBeUndefined()
    expect(config.idHeader).toBeUndefined()

    const fullConfig: WebhookConfig = {
      path: '/webhooks/github',
      secret: 'ghsec_abc',
      handler: 'system:processGithub',
      signatureHeader: 'x-hub-signature-256',
      dedup: false,
      idHeader: 'x-github-delivery',
    }
    expect(fullConfig.signatureHeader).toBe('x-hub-signature-256')
    expect(fullConfig.dedup).toBe(false)
    expect(fullConfig.idHeader).toBe('x-github-delivery')
  })
})

describe('verifyHmacSignature', () => {
  const secret = 'test-webhook-secret'
  const payload = '{"event":"payment.completed","id":"evt_123"}'

  test('verifies valid HMAC-SHA256 signature', () => {
    const signature = signHmac(payload, secret)
    expect(verifyHmacSignature(payload, signature, secret)).toBe(true)
  })

  test('rejects invalid signature', () => {
    const signature = signHmac(payload, secret)
    const tampered = signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0')
    expect(verifyHmacSignature(payload, tampered, secret)).toBe(false)
  })

  test('rejects empty signature', () => {
    expect(verifyHmacSignature(payload, '', secret)).toBe(false)
  })

  test('rejects signature with wrong length', () => {
    expect(verifyHmacSignature(payload, 'abcdef', secret)).toBe(false)
    expect(verifyHmacSignature(payload, 'a'.repeat(128), secret)).toBe(false)
  })

  test('uses timing-safe comparison (not ===)', () => {
    const valid = signHmac(payload, secret)
    expect(verifyHmacSignature(payload, valid, secret)).toBe(true)
    const sameLength = 'f'.repeat(valid.length)
    expect(verifyHmacSignature(payload, sameLength, secret)).toBe(false)
  })

  test('handles different payloads correctly', () => {
    const payload2 = '{"different":"data"}'
    const sig1 = signHmac(payload, secret)
    const sig2 = signHmac(payload2, secret)

    expect(verifyHmacSignature(payload, sig1, secret)).toBe(true)
    expect(verifyHmacSignature(payload2, sig2, secret)).toBe(true)
    expect(verifyHmacSignature(payload2, sig1, secret)).toBe(false)
  })

  test('never throws on malformed input', () => {
    expect(verifyHmacSignature(payload, 'not-hex-at-all!!!', secret)).toBe(false)
    expect(verifyHmacSignature(payload, 'zzzz'.repeat(16), secret)).toBe(false)
  })
})

describe('webhook deduplication', () => {
  beforeEach(async () => {
    await pglite.query('DELETE FROM "infra"."webhook_dedup"')
  })

  test('first webhook ID is not a duplicate', async () => {
    const isDuplicate = await checkAndRecordWebhook(db, 'wh_001', 'stripe')
    expect(isDuplicate).toBe(false)
  })

  test('same webhook ID is a duplicate', async () => {
    await checkAndRecordWebhook(db, 'wh_002', 'stripe')
    const isDuplicate = await checkAndRecordWebhook(db, 'wh_002', 'stripe')
    expect(isDuplicate).toBe(true)
  })

  test('different webhook IDs are not duplicates', async () => {
    expect(await checkAndRecordWebhook(db, 'wh_aaa', 'stripe')).toBe(false)
    expect(await checkAndRecordWebhook(db, 'wh_bbb', 'stripe')).toBe(false)
    expect(await checkAndRecordWebhook(db, 'wh_ccc', 'stripe')).toBe(false)
  })

  test('same ID with different source is not a duplicate (composite key)', async () => {
    expect(await checkAndRecordWebhook(db, 'wh_shared', 'stripe')).toBe(false)
    expect(await checkAndRecordWebhook(db, 'wh_shared', 'github')).toBe(false)
  })
})

function createMockScheduler(): Scheduler & {
  calls: Array<{ jobName: string; data: unknown }>
} {
  const calls: Array<{ jobName: string; data: unknown }> = []
  return {
    calls,
    async add(jobName: string, data: unknown) {
      calls.push({ jobName, data })
    },
    async send() {
      return null
    },
    async schedule() {},
    async unschedule() {},
    async stop() {},
  }
}

describe('createWebhookRoutes', () => {
  const secret = 'test-secret'
  const payload = JSON.stringify({ event: 'test', id: 'evt_1' })

  beforeEach(async () => {
    await pglite.query('DELETE FROM "infra"."webhook_dedup"')
  })

  function createWebhookTestApp(configs: Record<string, WebhookConfig>, mockScheduler: Scheduler) {
    return createWebhookRoutes(configs, { db, scheduler: mockScheduler })
  }

  test('receives webhook with valid signature and enqueues job', async () => {
    const scheduler = createMockScheduler()
    const app = createWebhookTestApp(
      {
        stripe: {
          path: '/webhooks/stripe',
          secret,
          handler: 'billing:processWebhook',
        },
      },
      scheduler,
    )

    const sig = signHmac(payload, secret)
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      body: payload,
      headers: {
        'x-webhook-signature': sig,
        'x-webhook-id': 'wh_001',
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(scheduler.calls).toHaveLength(1)
    expect(scheduler.calls[0].jobName).toBe('billing:processWebhook')
    expect(scheduler.calls[0].data).toEqual({
      source: 'stripe',
      webhookId: 'wh_001',
      payload: JSON.parse(payload),
    })
  })

  test('rejects invalid signature with 401', async () => {
    const scheduler = createMockScheduler()
    const app = createWebhookTestApp(
      {
        stripe: {
          path: '/webhooks/stripe',
          secret,
          handler: 'billing:processWebhook',
        },
      },
      scheduler,
    )

    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      body: payload,
      headers: {
        'x-webhook-signature': 'invalidsignature',
        'x-webhook-id': 'wh_002',
      },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
    expect(scheduler.calls).toHaveLength(0)
  })

  test('deduplicates same webhook ID', async () => {
    const scheduler = createMockScheduler()
    const app = createWebhookTestApp(
      {
        stripe: {
          path: '/webhooks/stripe',
          secret,
          handler: 'billing:processWebhook',
        },
      },
      scheduler,
    )

    const sig = signHmac(payload, secret)
    const headers = {
      'x-webhook-signature': sig,
      'x-webhook-id': 'wh_dup',
    }

    const res1 = await app.request('/webhooks/stripe', {
      method: 'POST',
      body: payload,
      headers,
    })
    expect(res1.status).toBe(200)
    expect(await res1.json()).toEqual({ received: true })

    const res2 = await app.request('/webhooks/stripe', {
      method: 'POST',
      body: payload,
      headers,
    })
    expect(res2.status).toBe(200)
    expect(await res2.json()).toEqual({ received: true, deduplicated: true })

    expect(scheduler.calls).toHaveLength(1)
  })

  test('skips dedup when dedup: false in config', async () => {
    const scheduler = createMockScheduler()
    const app = createWebhookTestApp(
      {
        stripe: {
          path: '/webhooks/stripe',
          secret,
          handler: 'billing:processWebhook',
          dedup: false,
        },
      },
      scheduler,
    )

    const sig = signHmac(payload, secret)
    const headers = {
      'x-webhook-signature': sig,
      'x-webhook-id': 'wh_nodup',
    }

    await app.request('/webhooks/stripe', {
      method: 'POST',
      body: payload,
      headers,
    })
    await app.request('/webhooks/stripe', {
      method: 'POST',
      body: payload,
      headers,
    })

    expect(scheduler.calls).toHaveLength(2)
  })

  test('uses custom signatureHeader when configured', async () => {
    const scheduler = createMockScheduler()
    const app = createWebhookTestApp(
      {
        github: {
          path: '/webhooks/github',
          secret,
          handler: 'gh:process',
          signatureHeader: 'x-hub-signature-256',
        },
      },
      scheduler,
    )

    const sig = signHmac(payload, secret)
    const res = await app.request('/webhooks/github', {
      method: 'POST',
      body: payload,
      headers: {
        'x-hub-signature-256': sig,
        'x-webhook-id': 'gh_001',
      },
    })

    expect(res.status).toBe(200)
    expect(scheduler.calls).toHaveLength(1)
  })

  test('uses custom idHeader when configured', async () => {
    const scheduler = createMockScheduler()
    const app = createWebhookTestApp(
      {
        github: {
          path: '/webhooks/github',
          secret,
          handler: 'gh:process',
          idHeader: 'x-github-delivery',
        },
      },
      scheduler,
    )

    const sig = signHmac(payload, secret)
    const headers = {
      'x-webhook-signature': sig,
      'x-github-delivery': 'gh_dup',
    }

    await app.request('/webhooks/github', {
      method: 'POST',
      body: payload,
      headers,
    })
    const res2 = await app.request('/webhooks/github', {
      method: 'POST',
      body: payload,
      headers,
    })

    expect(res2.status).toBe(200)
    expect(await res2.json()).toEqual({ received: true, deduplicated: true })
    expect(scheduler.calls).toHaveLength(1)
  })

  test('enqueues raw string payload when body is not valid JSON', async () => {
    const scheduler = createMockScheduler()
    const app = createWebhookTestApp(
      {
        stripe: {
          path: '/webhooks/stripe',
          secret,
          handler: 'billing:processWebhook',
        },
      },
      scheduler,
    )

    const rawBody = 'plain text payload'
    const sig = signHmac(rawBody, secret)
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      body: rawBody,
      headers: {
        'x-webhook-signature': sig,
        'x-webhook-id': 'wh_raw',
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(scheduler.calls).toHaveLength(1)
    expect(scheduler.calls[0].data).toEqual({
      source: 'stripe',
      webhookId: 'wh_raw',
      payload: 'plain text payload',
    })
  })

  test('returns 401 when signature header is missing', async () => {
    const scheduler = createMockScheduler()
    const app = createWebhookTestApp(
      {
        stripe: {
          path: '/webhooks/stripe',
          secret,
          handler: 'billing:processWebhook',
        },
      },
      scheduler,
    )

    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      body: payload,
      headers: {
        'x-webhook-id': 'wh_nosig',
      },
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid signature' })
    expect(scheduler.calls).toHaveLength(0)
  })
})
