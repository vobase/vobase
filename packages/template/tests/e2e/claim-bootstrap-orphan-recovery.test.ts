/**
 * Slice 2 — `claimAndBootstrap` orphan-recovery e2e (US-012)
 *
 * Exercises the orphan-recovery ("takeover on second-click") branch of
 * `claimAndBootstrap` through the Hono fetch stack, mirroring the pattern in
 * `tests/e2e/slice-1-handshake-roundtrip.test.ts`.
 *
 * Scenario:
 *   1. First invocation: platform handshake succeeds (returns allocation),
 *      vault.storeSecret throws → orphan window: platform has a claim, tenant
 *      DB has nothing.
 *   2. Second invocation (same opts): platform handshake is called again and
 *      returns the SAME allocation (platform idempotency contract on
 *      `(tenantSlug, environment, channelInstanceId)`). Vault now succeeds,
 *      upsertInstance succeeds, webhook registers. `claimAndBootstrap` returns
 *      `{ instanceId, webhookOk: true }`.
 *
 * No live HTTP, no live DB. Platform is an in-process Hono stub; vault +
 * upsertInstance are stubs injected via the same seams as
 * `modules/channels/managed/bootstrap.test.ts`.
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
import { verifyRequest } from '@vobase/core'
import { Hono } from 'hono'

import { sha256Hex, splitPathAndQuery } from '../../modules/channels/adapters/whatsapp/managed-transport'
import { claimAndBootstrap, type UpsertInstanceFn } from '../../modules/channels/managed/bootstrap'

// ─── Test fixtures ────────────────────────────────────────────────────────────

const TENANT_SLUG = 'tst0orphan1'
const HMAC_SECRET = 'test-fixture-hmac-secret-us012-orphan'
const ORG_ID = 'org_test_us012'
const PLATFORM_BASE_URL = 'http://localhost:19012' // never bound; in-process only
const KEY_VERSION = 1
const CHANNEL_INSTANCE_ID = `mgd-${ORG_ID}-staging`
const WEBHOOK_URL = `http://tenant.example/api/channels/webhook/whatsapp/${CHANNEL_INSTANCE_ID}`
const VERIFY_TOKEN = 'deterministic-verify-token-us012'

/**
 * The platform always returns this allocation for the given
 * `(tenantSlug, environment, channelInstanceId)` — mirroring the platform's
 * `readExistingClaim` idempotency contract. Both the first (failed) and second
 * (recovery) invocations receive identical data.
 */
const ALLOCATION = {
  platformChannelId: 'pcid-us012-orphan',
  wabaId: 'waba-us012',
  phoneNumberId: 'pnid-us012',
  displayPhoneNumber: '+6591234567',
  routineSecret: 'fresh-routine-us012',
  rotationKey: 'fresh-rotation-us012',
  keyVersion: 1,
  routineSecretPrevious: null,
  rotationKeyPrevious: null,
  previousValidUntil: null,
} as const

// ─── Platform stub ────────────────────────────────────────────────────────────

interface StubState {
  handshakeCalls: number
  registerCalls: number
}

/**
 * In-process platform stub. Verifies v2 2-key HMAC on every request and
 * returns the same allocation regardless of how many times `sandbox/create`
 * is called — that's the idempotency contract that makes orphan recovery work.
 */
function buildPlatformStub(state: StubState): Hono {
  const app = new Hono()

  const verifyV2 = (
    method: 'POST' | 'GET',
    path: string,
    bodyText: string,
    headers: {
      routine: string | null
      rotation: string | null
      keyVersion: string | null
      sigVersion: string | null
    },
  ): boolean => {
    if (!headers.routine || !headers.rotation || !headers.keyVersion || headers.sigVersion !== '2') {
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

  // POST /api/managed-whatsapp/sandbox/create — idempotent claim; returns the
  // same allocation on every call with the same channelInstanceId.
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
    return c.json(ALLOCATION)
  })

  // POST /api/provisioning/webhook-endpoints/register — always succeeds.
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
    // v3: response carries `endpointId` (12-char platform-minted nanoid).
    return c.json({
      endpointId: 'ep0us012orph',
      status: 'ok',
      registeredAt: new Date('2025-06-01T00:00:00Z').toISOString(),
    })
  })

  return app
}

// ─── Fetch patch helpers ──────────────────────────────────────────────────────

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
  globalThis.fetch = Object.assign(patched, original) as FetchFn
  return {
    restore: () => {
      globalThis.fetch = original
    },
  }
}

// ─── Stub factories ───────────────────────────────────────────────────────────

/**
 * Build a fake vault whose `storeSecret` can be toggled to throw. Mirrors
 * the stub in `modules/channels/managed/bootstrap.test.ts`.
 */
function buildFakeVault(opts: { storeSecretFails: boolean } = { storeSecretFails: false }): {
  vault: IntegrationsVault
  storeCalls: Array<{ provider: VaultProvider; input: StoreSecretInput }>
  setFails: (v: boolean) => void
} {
  let shouldFail = opts.storeSecretFails
  const storeCalls: Array<{ provider: VaultProvider; input: StoreSecretInput }> = []
  let stored: VaultRotation | null = null

  const vault: IntegrationsVault = {
    async storeSecret(provider, raw) {
      if (shouldFail) throw new Error('simulated vault commit failure (orphan window)')
      const normalized: StoreSecretInput = 'current' in raw ? raw : { current: raw as VaultPair, previous: null }
      storeCalls.push({ provider, input: normalized })
      stored = { current: normalized.current, previous: normalized.previous ?? null }
    },
    async hasSecret(_provider) {
      return stored !== null
    },
    async readSecret(_provider) {
      return stored
    },
    async rotate(_provider, _next, _validUntil) {
      /* unused */
    },
  }

  return {
    vault,
    storeCalls,
    setFails: (v) => {
      shouldFail = v
    },
  }
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
    const isNew = calls.length === 1
    return { instance, isNew }
  }
  return { fn, calls }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('claim-bootstrap orphan recovery (US-012, slice-2)', () => {
  let stubState: StubState
  let env: PatchedFetchEnv | null = null

  beforeEach(() => {
    stubState = { handshakeCalls: 0, registerCalls: 0 }
  })

  afterEach(() => {
    if (env) {
      env.restore()
      env = null
    }
  })

  it('orphan window: first call fails after platform claim; tenant has no state', async () => {
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

    // Platform handshake DID fire (orphan claim exists on platform side).
    expect(stubState.handshakeCalls).toBe(1)
    // Tenant DB commit never reached — upsert and webhook register did not run.
    expect(upsertCalls).toHaveLength(0)
    expect(stubState.registerCalls).toBe(0)
  })

  it('orphan recovery: second call reuses same platform claim and converges', async () => {
    const stub = buildPlatformStub(stubState)
    env = patchGlobalFetch(stub, PLATFORM_BASE_URL)

    const { vault, storeCalls, setFails } = buildFakeVault({ storeSecretFails: true })
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

    // First call: vault fails → orphan window.
    await expect(claimAndBootstrap(opts)).rejects.toThrow(/simulated vault commit failure/)
    expect(stubState.handshakeCalls).toBe(1)
    expect(upsertCalls).toHaveLength(0)

    // Fix the vault (simulates the operator retrying after the transient failure).
    setFails(false)

    // Second call: platform returns the SAME allocation (idempotency contract).
    // Vault upsert overwrites in place; upsertInstance creates the row; webhook
    // registers. Full success.
    const result = await claimAndBootstrap(opts)

    // Platform was called twice total — once per invocation.
    expect(stubState.handshakeCalls).toBe(2)
    // Both calls hit the same platformChannelId (idempotent claim).
    expect(result.instanceId).toBe(CHANNEL_INSTANCE_ID)
    expect(result.webhookOk).toBe(true)
    expect(result.webhookRegisteredAt).toBeDefined()

    // Vault stored on the second call only (first call threw before storing).
    expect(storeCalls).toHaveLength(1)
    expect(storeCalls[0]?.provider).toBe('vobase-platform')
    expect(storeCalls[0]?.input.current.routineSecret).toBe(ALLOCATION.routineSecret)

    // DB upsert ran twice (second invocation only): initial insert + the
    // post-webhook re-upsert that folds the platform-minted `endpointId`
    // into config. v3-only — pre-v3 it was a single upsert.
    expect(upsertCalls).toHaveLength(2)
    expect(upsertCalls[0]?.platformChannelId).toBe(ALLOCATION.platformChannelId)
    expect(upsertCalls[0]?.id).toBe(CHANNEL_INSTANCE_ID)
    expect(upsertCalls[1]?.config.endpointId).toBe('ep0us012orph')

    // Webhook registered once.
    expect(stubState.registerCalls).toBe(1)

    // Returned instance has correct identity.
    expect(result.instance.platformChannelId).toBe(ALLOCATION.platformChannelId)
    expect(result.instance.organizationId).toBe(ORG_ID)
  })

  it('orphan recovery goes through the Hono fetch stack end-to-end (HMAC verified)', async () => {
    // This variant makes the assertion explicit: the stub actually verifies the
    // v2 HMAC headers. If `claimAndBootstrap` sends a bad signature, the stub
    // returns 401, which bubbles up as a `PlatformHandshakeError`. Passing this
    // test proves the full Hono → fetch → signRequest → verifyRequest round-trip
    // is intact through the orphan path.
    const stub = buildPlatformStub(stubState)
    env = patchGlobalFetch(stub, PLATFORM_BASE_URL)

    const { vault } = buildFakeVault({ storeSecretFails: false })
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

    // HMAC verified by stub — if it weren't, stub returns 401 and this throws.
    expect(stubState.handshakeCalls).toBe(1)
    expect(stubState.registerCalls).toBe(1)
    expect(result.webhookOk).toBe(true)
    expect(result.instanceId).toBe(CHANNEL_INSTANCE_ID)
  })
})
