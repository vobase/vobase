/**
 * Shared scaffolding for `agent.index.test.ts` files. Each module that
 * contributes to `/INDEX.md` (messaging, schedules, contacts, …) ships a
 * `loadXxxIndexContributors` function with the same shape:
 *
 *   - takes `{ organizationId, <reader> }`
 *   - returns `SideLoadContributor[]`, each scoped to a build target
 *   - swallows reader errors so a single broken module never collapses
 *     `/INDEX.md`
 *
 * These helpers express the cross-module invariants once so each module's
 * test only encodes its module-specific output formatting.
 */

import { expect } from 'bun:test'
import { type IndexContributor, IndexFileBuilder } from '@vobase/core'

export const TEST_ORG_ID = 'org0test0'

export type IndexContributorLoader<TReader> = (input: {
  organizationId: string
  [key: string]: TReader | string | unknown
}) => Promise<readonly IndexContributor[]> | readonly IndexContributor[]

/**
 * Build a static reader stub: every method just resolves to the provided
 * `rows`. The reader's exact method name varies (`list`, `listEnabled`, …)
 * so callers pass it as the `methodName` arg.
 */
export function makeStaticReader<TReader>(methodName: keyof TReader, rows: unknown): TReader {
  return {
    [methodName]: () => Promise.resolve(rows),
  } as unknown as TReader
}

/**
 * Asserts `loader` swallows reader errors and yields a contributor whose
 * `render` returns `null` — the contract that keeps `/INDEX.md` from
 * collapsing when one module misbehaves.
 */
export async function assertContributorSwallowsErrors<TReader>(
  loader: IndexContributorLoader<TReader>,
  readerKey: string,
  rejectingMethod: keyof TReader,
): Promise<void> {
  const reader = {
    [rejectingMethod]: () => Promise.reject(new Error('boom')),
  } as unknown as TReader
  const contribs = await loader({ organizationId: TEST_ORG_ID, [readerKey]: reader })
  expect(contribs[0].render({ file: 'INDEX.md' })).toBeNull()
}

/**
 * Asserts the contributor only renders into `INDEX.md` — every other build
 * target (e.g. `AGENTS.md`) gets an empty string. This guards against a
 * contributor accidentally bleeding its content into the wrong file.
 */
export async function assertContributorRespectsBuildTarget<TReader>(
  loader: IndexContributorLoader<TReader>,
  readerKey: string,
  reader: TReader,
  expectedSnippet: string,
): Promise<void> {
  const contribs = await loader({ organizationId: TEST_ORG_ID, [readerKey]: reader })
  const builder = new IndexFileBuilder().registerAll(contribs)
  expect(builder.build({ file: 'AGENTS.md' })).toBe('')
  expect(builder.build({ file: 'INDEX.md' })).toContain(expectedSnippet)
}
