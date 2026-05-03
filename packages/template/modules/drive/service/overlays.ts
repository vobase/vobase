/**
 * Drive overlay registry — owner modules contribute virtual rows to the drive
 * tree via typed providers, without drive importing their schemas.
 *
 * Pattern mirrors `modules/channels/service/registry.ts` exactly:
 *   - `Map<id, entry>` process singleton
 *   - typed `register(...)` / `listProviders(scope)` / `__resetForTests()`
 *   - umbrella module owns spine + dispatcher, owner modules push providers
 *     during `init` (e.g. `agents/module.ts` calls `registerDriveOverlay(...)`)
 *
 * INVARIANT: providers MUST scope every query by `ctx.organizationId`. Returning
 * rows whose owning entity belongs to a different org is a Sev-1 bug. Drive
 * does NOT validate per-row organizationId — that is each provider's
 * responsibility.
 *
 * INVARIANT: provider ids must be unique. `register` throws on duplicate so
 * collisions surface at boot, not as silent last-write-wins behaviour.
 */

import type { DriveFile, DriveScopeName } from '../schema'
import type { DriveScope } from './types'
import { formatProviderId, type VirtualBackingScope } from './virtual-ids'

export interface DriveOverlayContext {
  scope: DriveScope
  parentId: string | null
  organizationId: string
}

export interface DriveOverlayReadContext {
  scope: DriveScope
  path: string
  organizationId: string
}

export interface DriveOverlayWriteContext {
  scope: DriveScope
  path: string
  content: string
  organizationId: string
}

export interface DriveOverlayProvider {
  /** Stable id for dedup + diagnostics, e.g. 'agents/skills'. MUST be unique. */
  readonly id: string
  /** Which drive scopes this provider augments. */
  readonly appliesTo: readonly DriveScopeName[]
  /**
   * Synthesize virtual rows visible in `listFolder(scope, parentId)`.
   * Return `[]` when nothing applies. Provider MUST filter by
   * `ctx.organizationId`.
   */
  list(ctx: DriveOverlayContext): Promise<DriveFile[]>
  /**
   * Resolve content for one of this provider's virtual paths.
   * Return `null` to mean "not mine, try next provider". Provider MUST
   * filter by `ctx.organizationId`. Optional `updatedAt` is threaded onto
   * the synthetic `DriveFile` returned by `readPath` so the UI can render
   * a real last-modified timestamp instead of the epoch placeholder.
   */
  read(ctx: DriveOverlayReadContext): Promise<{ content: string; updatedAt?: Date } | null>
  /** Optional write-through; absence = read-only overlay. */
  write?(ctx: DriveOverlayWriteContext): Promise<void>
}

const registry = new Map<string, DriveOverlayProvider>()

/**
 * Register a drive overlay provider. Throws on duplicate id — fail-fast so
 * boot-order races surface immediately rather than as last-write-wins.
 */
export function registerDriveOverlay(provider: DriveOverlayProvider): void {
  if (registry.has(provider.id)) {
    throw new Error(`drive/overlays: duplicate provider id '${provider.id}'`)
  }
  registry.set(provider.id, provider)
}

/** List providers whose `appliesTo` includes the given scope. */
export function listOverlayProviders(scope: DriveScopeName): DriveOverlayProvider[] {
  const out: DriveOverlayProvider[] = []
  for (const provider of registry.values()) {
    if (provider.appliesTo.includes(scope)) out.push(provider)
  }
  return out
}

/** Look up a provider by id (used by `readContent` to dispatch by id). */
export function getOverlayProvider(id: string): DriveOverlayProvider | null {
  return registry.get(id) ?? null
}

export function __resetOverlaysForTests(): void {
  registry.clear()
}

// ─── Provider row factory ──────────────────────────────────────────────────

/**
 * Input shape for `makeProviderRow`. Defaults all nullable `DriveFile` columns
 * so overlay providers don't have to spell out the full 22-field literal each
 * time they synthesize a virtual row.
 */
export interface ProviderRowInput {
  kind: 'folder' | 'file'
  providerId: string
  scope: VirtualBackingScope
  scopeId: string
  organizationId: string
  parentFolderId: string | null
  name: string
  path: string
  /** Provider-defined key segment that disambiguates this row's virtual id. */
  key: string
  updatedAt?: Date
  createdAt?: Date
}

/**
 * Build a `DriveFile` row for a virtual entry contributed by an overlay
 * provider. Nullable columns default to safe values; folders use
 * `inode/directory`, files use `text/markdown`.
 */
export function makeProviderRow(input: ProviderRowInput): DriveFile {
  const updatedAt = input.updatedAt ?? new Date(0)
  const createdAt = input.createdAt ?? updatedAt
  return {
    id: formatProviderId(input.providerId, input.scopeId, input.key),
    organizationId: input.organizationId,
    scope: input.scope,
    scopeId: input.scopeId,
    parentFolderId: input.parentFolderId,
    kind: input.kind,
    name: input.name,
    path: input.path,
    mimeType: input.kind === 'folder' ? 'inode/directory' : 'text/markdown',
    sizeBytes: 0,
    storageKey: null,
    caption: null,
    captionModel: null,
    captionUpdatedAt: null,
    extractedText: null,
    originalName: null,
    nameStem: null,
    source: null,
    sourceMessageId: null,
    tags: [],
    uploadedBy: null,
    processingStatus: 'ready',
    extractionKind: 'extracted',
    processingError: null,
    threatScanReport: null,
    createdAt,
    updatedAt,
  }
}
