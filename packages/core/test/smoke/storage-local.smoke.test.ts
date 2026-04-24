/**
 * Smoke: LocalStorage adapter round-trips real file I/O through a temp dir.
 *
 * Verifies upload → exists → download → list → delete on the actual filesystem
 * so regressions in path sanitization or Bun.file/Bun.write behavior surface
 * here instead of in template deployments.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { createLocalAdapter } from '../../src/adapters/storage/local'

let baseDir: string

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'vobase-storage-smoke-'))
})

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe('createLocalAdapter (smoke)', () => {
  it('upload → exists → download round-trips bytes verbatim', async () => {
    const adapter = createLocalAdapter({ basePath: baseDir })
    const payload = new TextEncoder().encode('hello world 🌍')
    await adapter.upload('files/hello.txt', payload)
    expect(await adapter.exists('files/hello.txt')).toBe(true)
    const back = await adapter.download('files/hello.txt')
    expect(new TextDecoder().decode(back)).toBe('hello world 🌍')
  })

  it('delete() removes the file and becomes idempotent thereafter', async () => {
    const adapter = createLocalAdapter({ basePath: baseDir })
    await adapter.upload('rm/me.bin', new Uint8Array([1, 2, 3]))
    expect(await adapter.exists('rm/me.bin')).toBe(true)
    await adapter.delete('rm/me.bin')
    expect(await adapter.exists('rm/me.bin')).toBe(false)
    // second delete must not throw — mirrors S3 semantics
    await adapter.delete('rm/me.bin')
  })

  it('list() returns objects under a prefix with stable metadata', async () => {
    const adapter = createLocalAdapter({ basePath: baseDir })
    await adapter.upload('photos/a.txt', new TextEncoder().encode('A'))
    await adapter.upload('photos/b.txt', new TextEncoder().encode('BB'))
    await adapter.upload('photos/nested/c.txt', new TextEncoder().encode('CCC'))

    const result = await adapter.list('photos')
    const keys = result.objects.map((o) => o.key).sort()
    expect(keys).toContain('photos/a.txt')
    expect(keys).toContain('photos/b.txt')
    expect(keys).toContain('photos/nested/c.txt')

    const aSize = result.objects.find((o) => o.key === 'photos/a.txt')?.size
    const bSize = result.objects.find((o) => o.key === 'photos/b.txt')?.size
    expect(aSize).toBe(1)
    expect(bSize).toBe(2)
  })

  it('rejects directory traversal in path arguments', async () => {
    const adapter = createLocalAdapter({ basePath: baseDir })
    await expect(adapter.upload('../escape.txt', new Uint8Array([0]))).rejects.toThrow()
    await expect(adapter.download('../../etc/passwd')).rejects.toThrow()
    await expect(adapter.delete('foo/../../../bar')).rejects.toThrow()
  })

  it('enforces maxSize on upload', async () => {
    const adapter = createLocalAdapter({ basePath: baseDir })
    const big = new Uint8Array(1024)
    await expect(adapter.upload('big.bin', big, { maxSize: 512 })).rejects.toThrow(/exceeds/)
  })

  it('download() on a missing key raises a validation error', async () => {
    const adapter = createLocalAdapter({ basePath: baseDir })
    await expect(adapter.download('never/uploaded.bin')).rejects.toThrow(/not found/i)
  })

  it('presign() returns the baseUrl-prefixed proxy path', async () => {
    const adapter = createLocalAdapter({ basePath: baseDir, baseUrl: '/files' })
    expect(adapter.presign('x/y.pdf', { method: 'GET' })).toBe('/files/x/y.pdf')
  })
})
