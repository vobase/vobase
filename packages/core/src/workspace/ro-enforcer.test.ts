import { describe, expect, it } from 'bun:test'
import { InMemoryFs } from 'just-bash'

import {
  buildReadOnlyConfig,
  checkWriteAllowed,
  globToRegExp,
  isWritablePath,
  ReadOnlyFsError,
  ScopedFs,
} from './ro-enforcer'

const WRITABLE = ['/contacts/c_abc/drive/', '/tmp/'] as const
const MEMORY_PATHS = ['/agents/a_xyz/MEMORY.md', '/contacts/c_abc/MEMORY.md'] as const
const RO_EXACT = ['/agents/a_xyz/AGENTS.md', '/contacts/c_abc/profile.md'] as const
const CONFIG = buildReadOnlyConfig({
  writablePrefixes: WRITABLE,
  readOnlyExact: RO_EXACT,
  memoryPaths: MEMORY_PATHS,
})

describe('checkWriteAllowed', () => {
  it('returns the generic RO message when no override is supplied', () => {
    const err = checkWriteAllowed('/drive/refunds/updated.md', CONFIG)
    expect(err).toBe('bash: /drive/refunds/updated.md: Read-only filesystem.')
  })

  it('honors `roMessageOverride` for platform-specific recovery hints', () => {
    const cfg = buildReadOnlyConfig({
      writablePrefixes: [],
      readOnlyExact: ['/agents/a_xyz/AGENTS.md'],
      roMessageOverride: (path) => {
        if (path.endsWith('/AGENTS.md')) return `bash: ${path}: Read-only filesystem.\n  Edit instructions instead.`
        return null
      },
    })
    const agentsMd = checkWriteAllowed('/agents/a_xyz/AGENTS.md', cfg)
    expect(agentsMd).toContain('Edit instructions instead.')

    // Falls back to the generic message when the override returns null.
    const driveErr = checkWriteAllowed('/drive/foo.md', cfg)
    expect(driveErr).toBe('bash: /drive/foo.md: Read-only filesystem.')
  })

  it('returns memory hint for agent MEMORY.md writes', () => {
    const err = checkWriteAllowed('/agents/a_xyz/MEMORY.md', CONFIG)
    expect(err).toBe('bash: /agents/a_xyz/MEMORY.md: use `vobase memory set|append|remove` to mutate memory safely.')
  })

  it('returns memory hint for contact MEMORY.md writes', () => {
    const err = checkWriteAllowed('/contacts/c_abc/MEMORY.md', CONFIG)
    expect(err).toContain('vobase memory set|append|remove')
  })

  it('allows contact drive + /tmp/ writes', () => {
    expect(checkWriteAllowed('/contacts/c_abc/drive/uploads/x.md', CONFIG)).toBeNull()
    expect(checkWriteAllowed('/tmp/tool-abc.txt', CONFIG)).toBeNull()
  })

  it('rejects readOnlyExact paths', () => {
    for (const p of ['/agents/a_xyz/AGENTS.md', '/contacts/c_abc/profile.md']) {
      expect(checkWriteAllowed(p, CONFIG)).toContain('Read-only')
    }
  })

  it('rejects writes to /drive/ root', () => {
    expect(checkWriteAllowed('/drive/BUSINESS.md', CONFIG)).toContain('Read-only')
  })

  it('default-denies unmatched paths like /etc/passwd', () => {
    expect(checkWriteAllowed('/etc/passwd', CONFIG)).toContain('Read-only filesystem')
  })
})

describe('isWritablePath', () => {
  it('is true for writable zones', () => {
    expect(isWritablePath('/contacts/c_abc/drive/a.md', WRITABLE)).toBe(true)
    expect(isWritablePath('/tmp/t.txt', WRITABLE)).toBe(true)
  })
  it('is true for memory paths when supplied', () => {
    expect(isWritablePath('/agents/a_xyz/MEMORY.md', WRITABLE, MEMORY_PATHS)).toBe(true)
    expect(isWritablePath('/contacts/c_abc/MEMORY.md', WRITABLE, MEMORY_PATHS)).toBe(true)
  })
  it('is false for RO zones', () => {
    expect(isWritablePath('/drive/BUSINESS.md', WRITABLE)).toBe(false)
    expect(isWritablePath('/agents/a_xyz/AGENTS.md', WRITABLE)).toBe(false)
  })
})

describe('ScopedFs', () => {
  it('throws ReadOnlyFsError on blocked write', async () => {
    const inner = new InMemoryFs()
    const fs = new ScopedFs(inner, CONFIG)
    await expect(fs.writeFile('/drive/x.md', 'x')).rejects.toBeInstanceOf(ReadOnlyFsError)
  })

  it('allows inner writes that would otherwise be blocked', async () => {
    const inner = new InMemoryFs()
    const fs = new ScopedFs(inner, CONFIG)
    await fs.innerWriteFile('/drive/BUSINESS.md', 'from-harness')
    const read = await fs.readFile('/drive/BUSINESS.md')
    expect(read).toBe('from-harness')
  })

  it('allows writes to writable zones', async () => {
    const inner = new InMemoryFs()
    const fs = new ScopedFs(inner, CONFIG)
    await fs.mkdir('/contacts/c_abc/drive/uploads', { recursive: true })
    await fs.writeFile('/contacts/c_abc/drive/uploads/a.md', 'body')
    expect(await fs.readFile('/contacts/c_abc/drive/uploads/a.md')).toBe('body')
  })

  it('config.writablePrefixes contains template-supplied prefixes', () => {
    expect(CONFIG.writablePrefixes).toContain('/contacts/c_abc/drive/')
    expect(CONFIG.writablePrefixes).toContain('/tmp/')
  })
})

describe('globToRegExp', () => {
  it('uses `*` for single-segment matches and `**` for cross-segment matches', () => {
    expect(globToRegExp('/agents/*/MEMORY.md').test('/agents/a-1/MEMORY.md')).toBe(true)
    // `*` does NOT cross `/`.
    expect(globToRegExp('/agents/*/MEMORY.md').test('/agents/a-1/sub/MEMORY.md')).toBe(false)

    expect(globToRegExp('/contacts/**/*.md').test('/contacts/c-1/notes/sub/a.md')).toBe(true)
    expect(globToRegExp('/contacts/**/*.md').test('/contacts/c-1/notes')).toBe(false)
  })

  it('escapes regex meta characters that appear literally in path patterns', () => {
    expect(globToRegExp('/a.b/foo').test('/a.b/foo')).toBe(true)
    // Without escaping, `.` would match any char.
    expect(globToRegExp('/a.b/foo').test('/aXb/foo')).toBe(false)
  })
})

describe('checkWriteAllowed — glob + cli precedence', () => {
  const config = buildReadOnlyConfig({
    writablePrefixes: ['/tmp/'],
    writableGlobs: ['/contacts/*/drive/**'],
    readOnlyGlobs: ['/contacts/*/drive/secret-*'],
    cliWritablePaths: ['/agents/a-1/MEMORY.md'],
  })

  it('writableGlobs grant access to nested paths', () => {
    expect(checkWriteAllowed('/contacts/c-1/drive/uploads/a.md', config)).toBeNull()
  })

  it('readOnlyGlobs win over writableGlobs', () => {
    const err = checkWriteAllowed('/contacts/c-1/drive/secret-budget.md', config)
    expect(err).toContain('Read-only filesystem')
  })

  it('cliWritablePaths reject direct writes but accept writes from a CLI verb origin', () => {
    const direct = checkWriteAllowed('/agents/a-1/MEMORY.md', config)
    expect(direct).toContain('only via a registered `vobase` verb')
    const fromCli = checkWriteAllowed('/agents/a-1/MEMORY.md', config, { cliVerb: 'memory set' })
    expect(fromCli).toBeNull()
  })

  it('default-deny still applies to paths outside any explicit allowlist', () => {
    const err = checkWriteAllowed('/random/file.md', config)
    expect(err).toContain('Read-only filesystem')
  })
})

describe('ScopedFs.withCliContext', () => {
  it('only relaxes cliWritablePaths inside the verb scope', async () => {
    const inner = new InMemoryFs()
    const config = buildReadOnlyConfig({
      writablePrefixes: ['/tmp/'],
      cliWritablePaths: ['/agents/a-1/MEMORY.md'],
    })
    const fs = new ScopedFs(inner, config)
    await expect(fs.writeFile('/agents/a-1/MEMORY.md', 'denied')).rejects.toBeInstanceOf(ReadOnlyFsError)
    await fs.withCliContext('memory set', async () => {
      await fs.writeFile('/agents/a-1/MEMORY.md', 'allowed')
    })
    expect(await fs.readFile('/agents/a-1/MEMORY.md')).toBe('allowed')
    // Outside the scope, writes are rejected again.
    await expect(fs.writeFile('/agents/a-1/MEMORY.md', 'denied-again')).rejects.toBeInstanceOf(ReadOnlyFsError)
  })

  it('restores prior cli context when the body throws', async () => {
    const inner = new InMemoryFs()
    const config = buildReadOnlyConfig({
      writablePrefixes: [],
      cliWritablePaths: ['/agents/a-1/MEMORY.md'],
    })
    const fs = new ScopedFs(inner, config)
    await expect(
      fs.withCliContext('memory set', async () => {
        throw new Error('verb failed')
      }),
    ).rejects.toThrow('verb failed')
    // No CLI context active any more — direct writes are rejected.
    await expect(fs.writeFile('/agents/a-1/MEMORY.md', 'x')).rejects.toBeInstanceOf(ReadOnlyFsError)
  })
})
