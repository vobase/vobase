/** Prefix for DB-backed custom scorer IDs to avoid collisions with code scorers. */
const CUSTOM_SCORER_PREFIX = 'custom-'

/** Build a prefixed scorer ID from a DB row ID. */
export function customScorerId(dbId: string): string {
  return `${CUSTOM_SCORER_PREFIX}${dbId}`
}
