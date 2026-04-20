import { describe, expect, it, mock } from 'bun:test'
import type { ScopedScheduler } from '@server/contracts/plugin-context'
import { buildScopedScheduler } from './scoped-scheduler'
import { NamespaceViolationError } from './validate-manifests'

function makeRaw(): ScopedScheduler & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = []
  return {
    calls,
    async send(name, data) {
      calls.push([name, data])
      return 'job-1'
    },
    async cancel() {},
    async schedule(name, _cron, data) {
      calls.push([name, data])
      return 'cron-1'
    },
  }
}

describe('buildScopedScheduler', () => {
  it('passes through unchanged when allowedQueues is undefined (Phase 0 backward compat)', async () => {
    const raw = makeRaw()
    const scoped = buildScopedScheduler({ moduleName: 'legacy', raw })
    expect(scoped).toBe(raw)
    await scoped.send('any-queue', { x: 1 })
    expect(raw.calls).toEqual([['any-queue', { x: 1 }]])
  })

  it('allows sends to declared queue suffixes', async () => {
    const raw = makeRaw()
    const scoped = buildScopedScheduler({ moduleName: 'inbox', allowedQueues: ['snooze'], raw })
    await scoped.send('snooze', { conversationId: 'c1' })
    expect(raw.calls).toEqual([['snooze', { conversationId: 'c1' }]])
  })

  it('throws NamespaceViolationError on sends to undeclared queues', async () => {
    const raw = makeRaw()
    const scoped = buildScopedScheduler({ moduleName: 'inbox', allowedQueues: ['snooze'], raw })
    await expect(scoped.send('evil', {})).rejects.toBeInstanceOf(NamespaceViolationError)
    expect(raw.calls).toEqual([])
  })

  it('error message names the violating module, queue, and the declared set', async () => {
    const raw = makeRaw()
    const scoped = buildScopedScheduler({ moduleName: 'inbox', allowedQueues: ['snooze', 'dlq'], raw })
    try {
      await scoped.send('other', {})
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(NamespaceViolationError)
      const e = err as NamespaceViolationError
      expect(e.moduleName).toBe('inbox')
      expect(e.namespace).toBe('queue')
      expect(e.path).toBe('other')
      expect(e.message).toContain('inbox')
      expect(e.message).toContain('other')
      expect(e.message).toContain('snooze')
      expect(e.message).toContain('dlq')
    }
  })

  it('cancel passes through regardless of allowedQueues (no namespace to enforce)', async () => {
    const raw = makeRaw()
    const cancelSpy = mock(async () => {})
    raw.cancel = cancelSpy
    const scoped = buildScopedScheduler({ moduleName: 'inbox', allowedQueues: ['snooze'], raw })
    await scoped.cancel('job-123')
    expect(cancelSpy).toHaveBeenCalledWith('job-123')
  })

  it('schedule enforces the same namespace rules as send', async () => {
    const raw = makeRaw()
    const scoped = buildScopedScheduler({ moduleName: 'inbox', allowedQueues: ['snooze'], raw })
    await scoped.schedule?.('snooze', '0 * * * *', { x: 1 })
    expect(raw.calls).toEqual([['snooze', { x: 1 }]])
    await expect(scoped.schedule?.('evil', '0 * * * *', {})).rejects.toBeInstanceOf(NamespaceViolationError)
  })

  it('empty allowedQueues blocks every send (explicit zero-allowlist)', async () => {
    const raw = makeRaw()
    const scoped = buildScopedScheduler({ moduleName: 'silent', allowedQueues: [], raw })
    await expect(scoped.send('anything', {})).rejects.toBeInstanceOf(NamespaceViolationError)
  })
})
