import { describe, expect, it } from 'bun:test'
import { InMemoryFs } from 'just-bash'
import { buildReadOnlyConfig, checkWriteAllowed, isWritablePath, ReadOnlyFsError, ScopedFs } from './ro-enforcer'

const WRITABLE_PREFIXES = ['/workspace/contact/drive/', '/workspace/tmp/'] as const
const CONFIG = buildReadOnlyConfig({ writablePrefixes: WRITABLE_PREFIXES })

describe('checkWriteAllowed', () => {
  it('returns spec-exact EROFS for /workspace/drive/*', () => {
    const err = checkWriteAllowed('/workspace/drive/refunds/updated.md', CONFIG)
    expect(err).toContain('bash: /workspace/drive/refunds/updated.md: Read-only filesystem.')
    expect(err).toContain('vobase drive propose --scope=organization --path=/refunds/updated.md --body=...')
  })

  it('returns memory hint for direct MEMORY.md writes', () => {
    const err = checkWriteAllowed('/workspace/MEMORY.md', CONFIG)
    expect(err).toBe('bash: /workspace/MEMORY.md: use `vobase memory set|append|remove` to mutate memory safely.')
  })

  it('returns memory hint for contact/MEMORY.md writes', () => {
    const err = checkWriteAllowed('/workspace/contact/MEMORY.md', CONFIG)
    expect(err).toContain('vobase memory set|append|remove')
  })

  it('allows contact drive writes', () => {
    expect(checkWriteAllowed('/workspace/contact/drive/uploads/x.md', CONFIG)).toBeNull()
    expect(checkWriteAllowed('/workspace/tmp/tool-abc.txt', CONFIG)).toBeNull()
  })

  it('rejects SOUL.md + AGENTS.md + profile.md + bookings.md', () => {
    for (const p of [
      '/workspace/SOUL.md',
      '/workspace/AGENTS.md',
      '/workspace/contact/profile.md',
      '/workspace/contact/bookings.md',
    ]) {
      expect(checkWriteAllowed(p, CONFIG)).toContain('Read-only')
    }
  })

  it('rejects writes to /workspace/skills/', () => {
    expect(checkWriteAllowed('/workspace/skills/new.md', CONFIG)).toContain('Read-only')
  })

  it('rejects writes outside /workspace entirely', () => {
    expect(checkWriteAllowed('/etc/passwd', CONFIG)).toContain('Read-only filesystem')
  })
})

describe('isWritablePath', () => {
  it('is true for writable zones', () => {
    expect(isWritablePath('/workspace/contact/drive/a.md', WRITABLE_PREFIXES)).toBe(true)
    expect(isWritablePath('/workspace/tmp/t.txt', WRITABLE_PREFIXES)).toBe(true)
    expect(isWritablePath('/workspace/MEMORY.md', WRITABLE_PREFIXES)).toBe(true)
    expect(isWritablePath('/workspace/contact/MEMORY.md', WRITABLE_PREFIXES)).toBe(true)
  })
  it('is false for RO zones', () => {
    expect(isWritablePath('/workspace/drive/BUSINESS.md', WRITABLE_PREFIXES)).toBe(false)
    expect(isWritablePath('/workspace/SOUL.md', WRITABLE_PREFIXES)).toBe(false)
  })
})

describe('ScopedFs', () => {
  it('throws ReadOnlyFsError on blocked write', async () => {
    const inner = new InMemoryFs()
    const fs = new ScopedFs(inner, CONFIG)
    await expect(fs.writeFile('/workspace/drive/x.md', 'x')).rejects.toBeInstanceOf(ReadOnlyFsError)
  })

  it('allows inner writes that would otherwise be blocked', async () => {
    const inner = new InMemoryFs()
    const fs = new ScopedFs(inner, CONFIG)
    await fs.innerWriteFile('/workspace/drive/BUSINESS.md', 'from-harness')
    const read = await fs.readFile('/workspace/drive/BUSINESS.md')
    expect(read).toBe('from-harness')
  })

  it('allows writes to writable zones', async () => {
    const inner = new InMemoryFs()
    const fs = new ScopedFs(inner, CONFIG)
    await fs.mkdir('/workspace/contact/drive/uploads', { recursive: true })
    await fs.writeFile('/workspace/contact/drive/uploads/a.md', 'body')
    expect(await fs.readFile('/workspace/contact/drive/uploads/a.md')).toBe('body')
  })

  it('uses template-supplied writable prefixes', () => {
    expect(CONFIG.writablePrefixes).toContain('/workspace/contact/drive/')
    expect(CONFIG.writablePrefixes).toContain('/workspace/tmp/')
  })
})
