import { describe, expect, it } from 'bun:test'
import type { BucketHandle, ScopedStorage } from '@server/contracts/plugin-context'
import { buildScopedStorage } from './scoped-storage'
import { NamespaceViolationError } from './validate-manifests'

function makeBucket(): BucketHandle {
  return {
    async put() {},
    async get() {
      return null
    },
    async delete() {},
  }
}

function makeRaw(): ScopedStorage & { requested: string[] } {
  const requested: string[] = []
  return {
    requested,
    getBucket(name: string) {
      requested.push(name)
      return makeBucket()
    },
  }
}

describe('buildScopedStorage', () => {
  it('passes through unchanged when allowedBuckets is undefined', () => {
    const raw = makeRaw()
    const scoped = buildScopedStorage({ moduleName: 'legacy', raw })
    expect(scoped).toBe(raw)
    scoped.getBucket('anything')
    expect(raw.requested).toEqual(['anything'])
  })

  it('allows getBucket for declared bucket suffixes', () => {
    const raw = makeRaw()
    const scoped = buildScopedStorage({ moduleName: 'drive', allowedBuckets: ['attachments'], raw })
    scoped.getBucket('attachments')
    expect(raw.requested).toEqual(['attachments'])
  })

  it('throws NamespaceViolationError for undeclared buckets', () => {
    const raw = makeRaw()
    const scoped = buildScopedStorage({ moduleName: 'drive', allowedBuckets: ['attachments'], raw })
    expect(() => scoped.getBucket('secrets')).toThrow(NamespaceViolationError)
    expect(raw.requested).toEqual([])
  })

  it('error message names module, bucket, and declared set', () => {
    const raw = makeRaw()
    const scoped = buildScopedStorage({ moduleName: 'drive', allowedBuckets: ['attachments', 'uploads'], raw })
    try {
      scoped.getBucket('secrets')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(NamespaceViolationError)
      const e = err as NamespaceViolationError
      expect(e.moduleName).toBe('drive')
      expect(e.namespace).toBe('bucket')
      expect(e.path).toBe('secrets')
      expect(e.message).toContain('drive')
      expect(e.message).toContain('secrets')
      expect(e.message).toContain('attachments')
      expect(e.message).toContain('uploads')
    }
  })

  it('empty allowedBuckets blocks every access', () => {
    const raw = makeRaw()
    const scoped = buildScopedStorage({ moduleName: 'silent', allowedBuckets: [], raw })
    expect(() => scoped.getBucket('anything')).toThrow(NamespaceViolationError)
  })
})
