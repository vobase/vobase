import { nanoid } from 'nanoid'

/** Mint a stable per-wake id. Exposed so tests can assert wake scoping. */
export function newWakeId(): string {
  return nanoid(12)
}
