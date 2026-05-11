/**
 * Unit tests for `claimAndBootstrap` (US-011 / §4.4).
 *
 * Coverage targets per the slice plan:
 *   - Happy path: handshake → vault.storeSecret → upsertInstance → webhook
 *     register; result.webhookOk === true.
 *   - Failure-after-claim: handshake succeeds, vault.storeSecret throws.
 *     The orchestrator propagates the error, leaving a platform claim with
 *     no tenant state — the documented orphan window. A second call (with
 *     a fixed vault) succeeds because the platform handshake is idempotent
 *     on `(tenantSlug, environment, channelInstanceId)`.
 *   - Takeover on second-click: re-invoking the orchestrator hits the same
 *     idempotency contract — the platform stub returns the SAME platform
 *     claim on repeated POSTs with the same channelInstanceId, the vault
 *     upsert is overwrite-in-place, the upsertInstance seam is idempotent.
 *   - In-process integration: a Hono stub for the platform stands in for
 *     `/api/managed-whatsapp/sandbox/create` and
 *     `/api/provisioning/webhook-endpoints/register`, mirroring the
 *     pattern in `tests/e2e/slice-1-handshake-roundtrip.test.ts`.
 *
 * No live DB, no live network. Vault + upsertInstance are stubs; platform
 * HTTP is in-process via `globalThis.fetch` patching.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ChannelInstance } from '@modules/channels/schema'
import type { UpsertManagedInput } from '@modules/channels/service/instances'
import type {
  IntegrationsVault,
  StoreSecretInput,
  VaultPair,
  VaultProvider,
  VaultRotation,
} from '@modules/integrations/service/vault'
import { signRequest, verifyRequest } from '@vobase/core'
import { Hono } from 'hono'

import { sha256Hex, splitPathAndQuery } from '../adapters/whatsapp/managed-transport'
import { claimAndBootstrap, type UpsertInstanceFn } from './bootstrap'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_SLUG = 'tst0tenant1'
const HMAC_SECRET = 'test-fixture-hmac-secret-us011-bootstrap'
const ORG_ID = 'org_test_us011'
const PLATFORM_BASE_URL = 'http://localhost:9999'
const KEY_VERSION = 1
const CHANNEL_INSTANCE_ID = `mgd-${ORG_ID}-staging`
const WEBHOOK_URL = `http://tenant.example/api/channels/webhook/whatsapp/${CHANNEL_INSTANCE_ID}`
const VERIFY_TOKEN = 'deterministic-verify-token-us011'

const ALLOCATION = {
  platformChannelId: 'pcid-us011',
  wabaId: 'waba-us011',
  phoneNumberId: 'pnid-us011',
  displayPhoneNumber: '+15551234567',
  routineSecret: 'fresh-routine-us011',
  rotationKey: 'fresh-rotation-us011',
  keyVersion: 1,
  routineSecretPrevious: null,
  rotationKeyPrevious: null,
  previousValidUntil: null,
} as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * In-process platform stub. Mirrors `slice-1-handshake-roundtrip.test.ts`
 * but covers the two POSTs `claimAndBootstrap` makes:
 *   - `/api/managed-whatsapp/sandbox/create` (handshake)
 *   - `/api/provisioning/webhook-endpoints/register` (webhook register)
 *
 * Records call counts so the tests can assert idempotency.
 */
interface StubState {
  handshakeCalls: number
  registerCalls: number
  registerFailsWith: number | null
}

function buildPlatformStub(state: StubState): Hono {
  const app = new Hono()

  const verifyV2 = (
    method: 'POST' | 'GET',
    path: string,
    bodyText: string,
    headers: { routine: string | null; rotation: string | null; keyVersion: string | null; sigVersion: string | null },
  ): boolean => {
    if (
      headers.routine === null ||
      headers.rotation === null ||
      headers.keyVersion === null ||
      headers.sigVersion !== '2'
    ) {
      return false
    }
    const keyVersionNum = Number.parseInt(headers.keyVersion, 10)
    if (!Number.isFinite(keyVersionNum)) return false

    const { pathOnly, sortedQuery } = splitPathAndQuery(path)
    const bodyDigest = sha256Hex(bodyText)
    const v2Payload = `${method}|${pathOnly}|${sortedQuery}|${bodyDigest}`

    const result = verifyRequest({
      body: v2Payload,
      routineSignature: headers.routine,
      rotationSignature: headers.rotation,
      keyVersion: keyVersionNum,
      maxKeyVersionSeen: 0,
      accept: [{ routineSecret: HMAC_SECRET, rotationKey: HMAC_SECRET, keyVersion: KEY_VERSION }],
    })
    return result.ok
  }

  app.post('/api/managed-whatsapp/sandbox/create', async (c) => {
    state.handshakeCalls += 1
    const bodyText = await c.req.text()
    const ok = verifyV2('POST', '/api/managed-whatsapp/sandbox/create', bodyText, {
      routine: c.req.header('X-Vobase-Routine-Sig') ?? null,
      rotation: c.req.header('X-Vobase-Rotation-Sig') ?? null,
      keyVersion: c.req.header('X-Vobase-Key-Version') ?? null,
      sigVersion: c.req.header('X-Vobase-Sig-Version') ?? null,
    })
    if (!ok) return c.json({ ok: false, code: 'unauthenticated' }, 401)
    // Always return the same allocation regardless of how many times we're
    // called — that's the platform's `readExistingClaim` semantics.
    return c.json(ALLOCATION)
  })

  app.post('/api/provisioning/webhook-endpoints/register', async (c) => {
    state.registerCalls += 1
    const bodyText = await c.req.text()
    const ok = verifyV2('POST', '/api/provisioning/webhook-endpoints/register', bodyText, {
      routine: c.req.header('X-Vobase-Routine-Sig') ?? null,
      rotation: c.req.header('X-Vobase-Rotation-Sig') ?? null,
      keyVersion: c.req.header('X-Vobase-Key-Version') ?? null,
      sigVersion: c.req.header('X-Vobase-Sig-Version') ?? null,
    })
    if (!ok) return c.json({ ok: false, reason: 'unauthenticated' }, 401)
    if (state.registerFailsWith !== null) {
      const status = state.registerFailsWith
      // Cast to Hono's `ContentfulStatusCode` union via `as 502` style —
      // the test only ever sets 502 so the literal narrows cleanly.
      return c.json({ ok: false, reason: 'challenge_failed' }, status as 502)
    }
    return c.json({ ok: true, registeredAt: new Date('2025-06-01T00:00:00Z').toISOString() })
  })

  return app
}

type FetchFn = typeof globalThis.fetch

interface PatchedFetchEnv {
  restore: () => void
}

function patchGlobalFetch(app: Hono, baseUrl: string): PatchedFetchEnv {
  const original = globalThis.fetch
  const patched: FetchFn = ((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(baseUrl)) {
      const req = new Request(url, init)
      return app.fetch(req)
    }
    return original(input, init)
  }) as FetchFn
  // `globalThis.fetch` carries extra methods (`preconnect`) on the type signature; the
  // simple lambda above is a subset of that type. Use Object.assign so we preserve any
  // properties the original had while substituting the callable.
  globalThis.fetch = Object.assign(patched, original) as FetchFn
  return {
    restore: () => {
      globalThis.fetch = original
    },
  }
}

/**
 * Build a fake `IntegrationsVault` whose `storeSecret` can be made to throw
 * (failure-after-claim test). `readSecret` / `hasSecret` / `rotate` are
 * implemented enough to satisfy the type without exercising real envelope
 * encryption.
 */
function buildFakeVault(opts: { storeSecretFails?: boolean } = {}): {
  vault: IntegrationsVault
  storeCalls: Array<{ provider: VaultProvider; input: StoreSecretInput }>
} {
  const storeCalls: Array<{ provider: VaultProvider; input: StoreSecretInput }> = []
  let stored: VaultRotation | null = null
  const vault: IntegrationsVault = {
    async storeSecret(provider, raw) {
      if (opts.storeSecretFails) {
        throw new Error('simulated vault commit failure (orphan window)')
      }
      const normalized: StoreSecretInput = 'current' in raw ? raw : { current: raw as VaultPair, previous: null }
      storeCalls.push({ provider, input: normalized })
      stored = {
        current: normalized.current,
        previous: normalized.previous ?? null,
      }
    },
    async hasSecret(_provider) {
      return stored !== null
    },
    async readSecret(_provider) {
      return stored
    },
    async rotate(_provider, _next, _validUntil) {
      // unused in these tests
    },
  }
  return { vault, storeCalls }
}

function buildFakeUpsert(): {
  fn: UpsertInstanceFn
  calls: UpsertManagedInput[]
} {
  const calls: UpsertManagedInput[] = []
  const fn: UpsertInstanceFn = async (input) => {
    calls.push(input)
    const now = new Date()
    const instance: ChannelInstance = {
      id: input.id ?? CHANNEL_INSTANCE_ID,
      organizationId: input.organizationId,
      channel: input.channel,
      role: 'customer',
      displayName: input.displayName,
      config: { ...input.config, platformChannelId: input.platformChannelId, mode: 'managed' },
      platformChannelId: input.platformChannelId,
      webhookSecret: null,
      status: 'active',
      setupStage: 'active',
      lastError: null,
      createdAt: now,
      updatedAt: now,
    }
    // First call is new; subsequent calls (same id) report not-new.
    const isNew = calls.length === 1
    return { instance, isNew }
  }
  return { fn, calls }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('claimAndBootstrap (US-011, §4.4)', () => {
  let stubState: StubState
  let env: PatchedFetchEnv | null = null

  beforeEach(() => {
    stubState = { handshakeCalls: 0, registerCalls: 0, registerFailsWith: null }
  })

  afterEach(() => {
    if (env) {
      env.restore()
      env = null
    }
  })

  it('happy path: all 4 steps succeed and webhookOk === true', async () => {
    const stub = buildPlatformStub(stubState)
    env = patchGlobalFetch(stub, PLATFORM_BASE_URL)

    const { vault, storeCalls } = buildFakeVault()
    const { fn: upsertInstance, calls: upsertCalls } = buildFakeUpsert()

    const result = await claimAndBootstrap({
      tenantSlug: TENANT_SLUG,
      environment: 'staging',
      channelInstanceId: CHANNEL_INSTANCE_ID,
      platformBaseUrl: PLATFORM_BASE_URL,
      hmacSecret: HMAC_SECRET,
      kind: 'sandbox',
      vault,
      upsertInstance,
      organizationId: ORG_ID,
      webhookUrl: WEBHOOK_URL,
      verifyToken: VERIFY_TOKEN,
    })

    expect(stubState.handshakeCalls).toBe(1)
    expect(stubState.registerCalls).toBe(1)
    expect(storeCalls).toHaveLength(1)
    expect(storeCalls[0]?.provider).toBe('vobase-platform')
    expect(storeCalls[0]?.input.current.routineSecret).toBe(ALLOCATION.routineSecret)
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0]?.platformChannelId).toBe(ALLOCATION.platformChannelId)
    expect(upsertCalls[0]?.config.kind).toBe('sandbox')
    expect(result.instanceId).toBe(CHANNEL_INSTANCE_ID)
    expect(result.webhookOk).toBe(true)
    expect(result.webhookRegisteredAt).toBeDefined()
  })

  it('failure-after-claim: vault throws → platform has claim, tenant has no state (orphan)', async () => {
    const stub = buildPlatformStub(stubState)
    env = patchGlobalFetch(stub, PLATFORM_BASE_URL)

    const { vault } = buildFakeVault({ storeSecretFails: true })
    const { fn: upsertInstance, calls: upsertCalls } = buildFakeUpsert()

    await expect(
      claimAndBootstrap({
        tenantSlug: TENANT_SLUG,
        environment: 'staging',
        channelInstanceId: CHANNEL_INSTANCE_ID,
        platformBaseUrl: PLATFORM_BASE_URL,
        hmacSecret: HMAC_SECRET,
        kind: 'sandbox',
        vault,
        upsertInstance,
        organizationId: ORG_ID,
        webhookUrl: WEBHOOK_URL,
        verifyToken: VERIFY_TOKEN,
      }),
    ).rejects.toThrow(/simulated vault commit failure/)

    // Platform handshake DID run (orphan claim on the platform); tenant
    // upsert never reached (orphan window on the tenant).
    expect(stubState.handshakeCalls).toBe(1)
    expect(upsertCalls).toHaveLength(0)
    expect(stubState.registerCalls).toBe(0)
  })

  it('takeover on second-click: re-invocation reuses platform claim and converges to a single row', async () => {
    const stub = buildPlatformStub(stubState)
    env = patchGlobalFetch(stub, PLATFORM_BASE_URL)

    const { vault, storeCalls } = buildFakeVault()
    const { fn: upsertInstance, calls: upsertCalls } = buildFakeUpsert()

    const opts = {
      tenantSlug: TENANT_SLUG,
      environment: 'staging' as const,
      channelInstanceId: CHANNEL_INSTANCE_ID,
      platformBaseUrl: PLATFORM_BASE_URL,
      hmacSecret: HMAC_SECRET,
      kind: 'sandbox' as const,
      vault,
      upsertInstance,
      organizationId: ORG_ID,
      webhookUrl: WEBHOOK_URL,
      verifyToken: VERIFY_TOKEN,
    }

    const first = await claimAndBootstrap(opts)
    const second = await claimAndBootstrap(opts)

    // Two clicks, two handshakes — but they returned the same platform claim
    // (platformChannelId stable across calls) since the stub embodies the
    // platform's `readExistingClaim` idempotency contract.
    expect(stubState.handshakeCalls).toBe(2)
    expect(first.instance.platformChannelId).toBe(ALLOCATION.platformChannelId)
    expect(second.instance.platformChannelId).toBe(ALLOCATION.platformChannelId)
    expect(first.instanceId).toBe(second.instanceId)
    // Vault upsert is overwrite-in-place — two store calls, but the stored
    // value remains the same shape.
    expect(storeCalls).toHaveLength(2)
    expect(storeCalls[0]?.input.current.routineSecret).toBe(storeCalls[1]?.input.current.routineSecret)
    // Upsert called twice with the same channelInstanceId — second call
    // resolves as not-new (`isNew === false`) in our stub.
    expect(upsertCalls).toHaveLength(2)
    expect(upsertCalls[0]?.id).toBe(upsertCalls[1]?.id)
  })

  it('webhook register failure is non-fatal: result.webhookOk === false with detail', async () => {
    stubState.registerFailsWith = 502
    const stub = buildPlatformStub(stubState)
    env = patchGlobalFetch(stub, PLATFORM_BASE_URL)

    const { vault } = buildFakeVault()
    const { fn: upsertInstance } = buildFakeUpsert()

    const result = await claimAndBootstrap({
      tenantSlug: TENANT_SLUG,
      environment: 'staging',
      channelInstanceId: CHANNEL_INSTANCE_ID,
      platformBaseUrl: PLATFORM_BASE_URL,
      hmacSecret: HMAC_SECRET,
      kind: 'sandbox',
      vault,
      upsertInstance,
      organizationId: ORG_ID,
      webhookUrl: WEBHOOK_URL,
      verifyToken: VERIFY_TOKEN,
    })

    expect(result.webhookOk).toBe(false)
    expect(result.webhookDetail).toContain('webhook registration failed')
    // The claim row + vault are still persisted — the §4.4 trade-off.
    expect(stubState.handshakeCalls).toBe(1)
    expect(stubState.registerCalls).toBe(1)
  })

  it('unknown kind throws (registry guard)', async () => {
    const { vault } = buildFakeVault()
    const { fn: upsertInstance } = buildFakeUpsert()
    await expect(
      claimAndBootstrap({
        tenantSlug: TENANT_SLUG,
        environment: 'staging',
        channelInstanceId: CHANNEL_INSTANCE_ID,
        platformBaseUrl: PLATFORM_BASE_URL,
        hmacSecret: HMAC_SECRET,
        // Cast intentionally — exercising the runtime guard on an unknown kind.
        kind: 'notification' as unknown as 'sandbox',
        vault,
        upsertInstance,
        organizationId: ORG_ID,
        webhookUrl: WEBHOOK_URL,
        verifyToken: VERIFY_TOKEN,
      }),
    ).rejects.toThrow(/unknown channel kind/)
  })

  it('signRequest + verifyRequest round-trip used by the stub stays symmetric', () => {
    // Sanity test mirrors slice-1-handshake-roundtrip.test.ts — guards
    // against an upstream signature contract drift breaking this file's stub.
    const path = '/api/managed-whatsapp/sandbox/create'
    const body = JSON.stringify({ environment: 'staging', channelInstanceId: CHANNEL_INSTANCE_ID })
    const { pathOnly, sortedQuery } = splitPathAndQuery(path)
    const bodyDigest = sha256Hex(body)
    const v2Payload = `POST|${pathOnly}|${sortedQuery}|${bodyDigest}`
    const signed = signRequest({
      body: v2Payload,
      routineSecret: HMAC_SECRET,
      rotationKey: HMAC_SECRET,
      keyVersion: KEY_VERSION,
    })
    const result = verifyRequest({
      body: v2Payload,
      routineSignature: signed.routineSignature,
      rotationSignature: signed.rotationSignature,
      keyVersion: signed.keyVersion,
      maxKeyVersionSeen: 0,
      accept: [{ routineSecret: HMAC_SECRET, rotationKey: HMAC_SECRET, keyVersion: KEY_VERSION }],
    })
    expect(result.ok).toBe(true)
  })
})
