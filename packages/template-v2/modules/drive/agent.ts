/**
 * Agent-facing surfaces for the drive module. Materializers only —
 * `/drive/BUSINESS.md` is wake-scoped to the org via the FilesService factory.
 */

export { BUSINESS_MD_FALLBACK, buildDriveMaterializers as buildMaterializers } from './materializers'
