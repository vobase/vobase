/** @contract platform-tenant-v1 */
/**
 * channels/managed/bootstrap — `claimAndBootstrap` orchestrator (per §4.4).
 *
 * Replaces the inline 4-step claim sequence that used to live at
 * `adapters/whatsapp/handlers/managed.ts:113-232`. Synchronous under §7.12:
 * the UI POSTs the claim and the handler runs steps 1-3 inline.
 *
 * Steps:
 *   1. POST `/api/managed-whatsapp/sandbox/create` (handshake) — get
 *      platformChannelId / displayPhoneNumber / phoneNumberId / secret pair.
 *   2. Tenant DB commit — `vault.storeSecret(...)` + `upsertManagedInstance(...)`.
 *   3. POST `/api/provisioning/webhook-endpoints/register` — webhook
 *      self-register; failure is non-fatal and recoverable via the manual
 *      "Re-verify" button (§4.4 step 6 trade-off).
 *
 * **Orphan recovery / "takeover on second-click":** if step 2 fails after
 * step 1 succeeded, we have a platform claim with no tenant state. The
 * platform's existing self-heal in
 * `vobase-platform/modules/managed-whatsapp/service.ts` ("orphan claim
 * takeover") makes the second click idempotent on
 * `(tenantSlug, environment, channelInstanceId)` — re-calling
 * `/sandbox/create` with the same channelInstanceId returns fresh secrets
 * for the same platform claim, vault upsert overwrites in place, and the
 * row gets re-created. We do not need explicit takeover code here; we
 * just rely on the platform contract.
 *
 * Testability: vault + DB writes are injected so tests can use stubs
 * without booting a real Postgres. Platform HTTP calls go through
 * `handshakeWithPlatform` / `registerWebhookWithPlatform`, which use
 * `globalThis.fetch`; tests monkey-patch the global fetch (same pattern
 * as `tests/e2e/slice-1-handshake-roundtrip.test.ts`) to drive the
 * round-trip in-process against a Hono stub.
 */

import type { ChannelInstance } from '@modules/channels/schema'
import type { UpsertManagedInput } from '@modules/channels/service/instances'
import {
  type HandshakeAllocation,
  handshakeWithPlatform,
  PlatformHandshakeError,
  registerWebhookWithPlatform,
} from '@modules/integrations/service/handshake'
import type { IntegrationsVault } from '@modules/integrations/service/vault'

import { findKind, type ManagedChannelKind } from './registry'

/**
 * Single-row upsert seam. Real callers pass
 * `(input) => upsertManagedInstance(db, input)`. Tests pass a stub that
 * captures `input` and returns a synthetic `ChannelInstance`, so they
 * don't need a real Postgres.
 */
export type UpsertInstanceFn = (input: UpsertManagedInput) => Promise<{ instance: ChannelInstance; isNew: boolean }>

export interface ClaimAndBootstrapOpts {
  /** Tenant identity for the platform. Header `X-Tenant-Id` value. */
  tenantSlug: string
  /** Indicative env label — `production` | `staging`. */
  environment: 'production' | 'staging'
  /**
   * Stable per-(org, env, kind) channel instance id. Re-clicks (multi-tab,
   * post-`db:reset`, mid-flight crash) all converge to the same row. Must
   * match what the platform persists in `tester_links.channel_instance_id`
   * so platform-side `readExistingClaim` returns the same secret pair.
   */
  channelInstanceId: string
  /** Platform base URL (must match env allowlist — see `isAllowedPlatformBaseUrl`). */
  platformBaseUrl: string
  /** Tenant HMAC secret used to sign outbound platform calls. */
  hmacSecret: string
  /**
   * Channel kind from the registry. Threads through to platform path
   * selection (`registry.claimPath`), vault provider, and the
   * `channel_instances.{channel, role, config.mode, displayName}`
   * discriminators written via `upsertManagedInstance`.
   */
  kind: ManagedChannelKind
  /** Per-org integrations vault for storing the rotation secret. */
  vault: IntegrationsVault
  /**
   * Channel-instances upsert. Default in production binds the installed
   * tenant `ScopedDb` (see `claimAndBootstrap` callers); tests inject a
   * stub so they can run without Postgres.
   */
  upsertInstance: UpsertInstanceFn
  /** Tenant org id (for the channel-instances row). */
  organizationId: string
  /** Webhook URL the platform will POST inbound payloads to. */
  webhookUrl: string
  /** Verify-token derived from `BETTER_AUTH_SECRET` for the GET hub challenge. */
  verifyToken: string
  /**
   * Optional id of the AI agent that should be the channel's default assignee
   * — written into `channel_instances.config.defaultAssignee` so the inbound
   * webhook router routes new conversations to this agent. Resolved by the
   * handler (first enabled `agent_definitions` row) so bootstrap stays
   * agent-schema-agnostic.
   */
  defaultAssignee?: string | null
}

export interface ClaimAndBootstrapResult {
  /** Tenant-side channel-instances.id (== input `channelInstanceId`). */
  instanceId: string
  /** Full row for callers that want to surface it in the response. */
  instance: ChannelInstance
  /** Whether the webhook self-register succeeded. */
  webhookOk: boolean
  /** Human-readable detail when `webhookOk === false`. */
  webhookDetail?: string
  /** Persisted `registeredAt` ISO string when `webhookOk === true`. */
  webhookRegisteredAt?: string
  /**
   * Platform-minted 12-char endpoint id returned by
   * `/webhook-endpoints/register` (v3 only). The QR encoding uses
   * `/link <endpointId>` so we surface it back to callers that want to
   * render it without re-reading `channel_instances.config.endpointId`.
   * Undefined when the register leg failed (`webhookOk === false`).
   */
  endpointId?: string
}

/**
 * Per §4.4. Synchronous, idempotent on
 * `(tenantSlug, environment, channelInstanceId)`. Throws
 * `PlatformHandshakeError` on platform 4xx/5xx (caller surfaces structured
 * error; user re-clicks for transients).
 */
export async function claimAndBootstrap(opts: ClaimAndBootstrapOpts): Promise<ClaimAndBootstrapResult> {
  // Registry consult: today only `sandbox` exists, so `vaultProvider` is
  // `'vobase-platform'`. Looking it up via the registry (instead of inlining
  // the literal) is the seam a future kind plugs into.
  const kindSpec = findKind(opts.kind)

  // ─── Step 1: platform handshake (claim) ────────────────────────────────
  // POST /api/managed-whatsapp/sandbox/create. Returns the secret pair +
  // platform-side metadata. Idempotent on
  // (tenantSlug, environment, channelInstanceId) — repeated calls (orphan
  // recovery / second-click) return either the same secret pair (when the
  // claim is < TTL) or fresh keys for the same claim (after TTL).
  const allocation: HandshakeAllocation = await handshakeWithPlatform({
    platformBaseUrl: opts.platformBaseUrl,
    tenantId: opts.tenantSlug,
    tenantHmacSecret: opts.hmacSecret,
    environment: opts.environment,
    channelInstanceId: opts.channelInstanceId,
    kind: opts.kind,
  })

  // ─── Step 2: tenant DB commit (vault + channel_instances) ──────────────
  // The HTTP handshake cannot live inside the tenant DB tx, so the brief
  // window between step 1 success and step 2 success is the orphan window.
  // Recovery: a second click re-runs step 1 (idempotent on platform side),
  // re-stores the secret (vault upsert is overwrite-in-place), and re-runs
  // the upsert (idempotent on `(orgId, channel, platformChannelId)`).
  const previous =
    allocation.routineSecretPrevious && allocation.rotationKeyPrevious && allocation.previousValidUntil
      ? {
          routineSecret: allocation.routineSecretPrevious,
          rotationKey: allocation.rotationKeyPrevious,
          keyVersion: Math.max(0, allocation.keyVersion - 1),
          validUntil: new Date(allocation.previousValidUntil),
        }
      : null

  await opts.vault.storeSecret(kindSpec.vaultProvider, {
    current: {
      routineSecret: allocation.routineSecret,
      rotationKey: allocation.rotationKey,
      keyVersion: allocation.keyVersion,
    },
    previous,
  })

  // Prefer the platform-assigned `label` so the tenant row matches what the
  // platform admin chose (e.g. "Vobase Sandbox SG"). Fall back to the generic
  // per-kind label when the platform didn't return one (pre-label deploy).
  const displayName = allocation.label?.trim() || `${kindSpec.displayLabel} (${opts.environment})`
  const { instance } = await opts.upsertInstance({
    id: opts.channelInstanceId,
    organizationId: opts.organizationId,
    channel: kindSpec.channelName,
    platformChannelId: allocation.platformChannelId,
    displayName,
    role: kindSpec.role,
    config: {
      // `organizationId` lives in config too because the WhatsApp adapter's
      // `isManagedConfig` predicate reads it from `config` (the registry only
      // passes `(name, config, instanceId)`). Without it the predicate fails
      // and the factory falls into the explicit-config branch, demanding
      // accessToken/appSecret/verifyToken from env.
      organizationId: opts.organizationId,
      platformChannelId: allocation.platformChannelId,
      platformBaseUrl: opts.platformBaseUrl,
      displayPhoneNumber: allocation.displayPhoneNumber,
      phoneNumberId: allocation.phoneNumberId,
      wabaId: allocation.wabaId,
      environment: opts.environment,
      kind: opts.kind,
      ...(opts.defaultAssignee ? { defaultAssignee: opts.defaultAssignee } : {}),
    },
  })

  // ─── Step 3: webhook self-register (best-effort) ───────────────────────
  // The §4.4 trade-off: failure here leaves a usable claim row; the UI
  // surfaces a "Re-verify" button that re-runs `POST /managed/:id/webhook/re-verify`.
  // We never fail the whole orchestrator on this leg.
  //
  // Provider literal MUST match what the adapter's GET-challenge handler
  // uses to derive the verify token (see `factory.ts::createManagedAdapter`
  // — it reads the same `kindSpec.channelName`); the literal also scopes a
  // distinct slot in the platform's `tenant_webhook_endpoints` table.
  //
  // v3: the register call no longer carries `channelInstanceId`; the
  // platform mints an `endpointId` and returns it on success. We persist
  // that id back into `config.endpointId` so the `/link <endpointId>` QR
  // encoding can read it without re-fetching from the platform.
  let result: ClaimAndBootstrapResult
  try {
    const registered = await registerWebhookWithPlatform({
      platformBaseUrl: opts.platformBaseUrl,
      tenantId: opts.tenantSlug,
      tenantHmacSecret: opts.hmacSecret,
      provider: kindSpec.channelName,
      webhookUrl: opts.webhookUrl,
      verifyToken: opts.verifyToken,
    })
    // Re-upsert with the endpointId folded into config. `upsertManagedInstance`
    // shallow-merges `config` on conflict, so existing adapter-set keys
    // (e.g. `lastSyncAt`) are preserved.
    const { instance: refreshed } = await opts.upsertInstance({
      id: instance.id,
      organizationId: opts.organizationId,
      channel: kindSpec.channelName,
      platformChannelId: allocation.platformChannelId,
      displayName: instance.displayName ?? displayName,
      role: kindSpec.role,
      config: {
        ...(instance.config ?? {}),
        endpointId: registered.endpointId,
      },
    })
    result = {
      instanceId: refreshed.id,
      instance: refreshed,
      webhookOk: true,
      webhookRegisteredAt: registered.registeredAt,
      endpointId: registered.endpointId,
    }
  } catch (err) {
    const detail = err instanceof PlatformHandshakeError ? err.message : err instanceof Error ? err.message : 'unknown'
    result = {
      instanceId: instance.id,
      instance,
      webhookOk: false,
      webhookDetail: detail,
    }
  }

  return result
}
