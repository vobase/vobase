import { describe, expect, it } from 'bun:test'
import { Project } from 'ts-morph'

import { runChecks } from './check-emit'

const TEMPLATE_ROOT = '/fake/template'
const EVENTS_FILE_REL = 'modules/automations/service/events.ts'

// Registry with only `cron` allowed from wake/heartbeat.ts
const TEST_REGISTRY: Record<string, readonly string[]> = {
  cron: ['wake/heartbeat.ts'],
}

/**
 * Build a virtual ts-morph Project with in-memory source files.
 * The events.ts stub exports `emit` so symbol resolution works.
 */
function makeProject(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true })

  // Add the canonical events.ts so `emit` resolves to it
  project.createSourceFile(
    `${TEMPLATE_ROOT}/${EVENTS_FILE_REL}`,
    `export async function emit(name: string, payload: unknown, ctx: { tx: unknown }): Promise<void> {}`,
  )

  for (const [relPath, content] of Object.entries(files)) {
    project.createSourceFile(`${TEMPLATE_ROOT}/${relPath}`, content)
  }

  return project
}

describe('runChecks()', () => {
  it('passes (lenient) when no emit calls exist', () => {
    const project = makeProject({
      'modules/messaging/service/conversations.ts': `export function foo() {}`,
    })
    const result = runChecks({
      project,
      registry: TEST_REGISTRY,
      eventsFileRel: EVENTS_FILE_REL,
      templateRoot: TEMPLATE_ROOT,
    })
    expect(result.errors).toHaveLength(0)
    expect(result.warnings.some((w) => w.includes('lenient'))).toBe(true)
  })

  it('fails with rogue-producer when emit call is in a non-allowlisted file', () => {
    const project = makeProject({
      'modules/messaging/service/conversations.ts': `
        import { emit } from '${TEMPLATE_ROOT}/${EVENTS_FILE_REL}'
        export async function test(tx: unknown) {
          await emit('cron', { scheduleId: 's1', intendedRunAt: '2026-05-17T00:00:00Z' }, { tx })
        }
      `,
    })
    const result = runChecks({
      project,
      registry: TEST_REGISTRY,
      eventsFileRel: EVENTS_FILE_REL,
      templateRoot: TEMPLATE_ROOT,
    })
    expect(result.errors.some((e) => e.includes('rogue producer'))).toBe(true)
  })

  it('fails when emit is called with only 2 args (missing { tx })', () => {
    // wake/heartbeat.ts is not under modules/**/service/ or tools/, so the checker
    // won't walk it. Test against a modules path for this check.
    const project2 = makeProject({
      'modules/automations/service/dispatcher.ts': `
        import { emit } from '${TEMPLATE_ROOT}/${EVENTS_FILE_REL}'
        export async function test() {
          await emit('cron', { scheduleId: 's1', intendedRunAt: '2026-05-17T00:00:00Z' })
        }
      `,
    })
    const result = runChecks({
      project: project2,
      registry: TEST_REGISTRY,
      eventsFileRel: EVENTS_FILE_REL,
      templateRoot: TEMPLATE_ROOT,
    })
    expect(result.errors.some((e) => e.includes('expected 3 arguments'))).toBe(true)
  })

  it('fails when third arg is not an object literal', () => {
    const project = makeProject({
      'modules/automations/service/dispatcher.ts': `
        import { emit } from '${TEMPLATE_ROOT}/${EVENTS_FILE_REL}'
        export async function test(ctx: unknown) {
          await emit('cron', { scheduleId: 's1', intendedRunAt: '2026-05-17T00:00:00Z' }, ctx as { tx: unknown })
        }
      `,
    })
    const result = runChecks({
      project,
      registry: TEST_REGISTRY,
      eventsFileRel: EVENTS_FILE_REL,
      templateRoot: TEMPLATE_ROOT,
    })
    expect(result.errors.some((e) => e.includes('must be an object literal'))).toBe(true)
  })

  it('fails when third arg object literal is missing tx property', () => {
    const project = makeProject({
      'modules/automations/service/dispatcher.ts': `
        import { emit } from '${TEMPLATE_ROOT}/${EVENTS_FILE_REL}'
        export async function test() {
          await emit('cron', { scheduleId: 's1', intendedRunAt: '2026-05-17T00:00:00Z' }, { notTx: true })
        }
      `,
    })
    const result = runChecks({
      project,
      registry: TEST_REGISTRY,
      eventsFileRel: EVENTS_FILE_REL,
      templateRoot: TEMPLATE_ROOT,
    })
    expect(result.errors.some((e) => e.includes('no tx property'))).toBe(true)
  })

  it('does not flag socket.emit or other unrelated emit calls', () => {
    const project = makeProject({
      'modules/messaging/service/conversations.ts': `
        declare const socket: { emit: (event: string, data: unknown) => void }
        export function test() {
          socket.emit('message', { foo: 'bar' })
        }
      `,
    })
    const result = runChecks({
      project,
      registry: TEST_REGISTRY,
      eventsFileRel: EVENTS_FILE_REL,
      templateRoot: TEMPLATE_ROOT,
    })
    expect(result.errors).toHaveLength(0)
  })
})
