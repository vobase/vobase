import { describe, expect, it } from 'bun:test'
import { InMemoryFs } from 'just-bash'

import { buildReadOnlyConfig, checkWriteAllowed, isWritablePath, ReadOnlyFsError, ScopedFs } from './ro-enforcer'

const WRITABLE = ['/contacts/c_abc/drive/', '/tmp/'] as const
const MEMORY_PATHS = ['/agents/a_xyz/MEMORY.md', '/contacts/c_abc/MEMORY.md'] as const
const RO_EXACT = ['/agents/a_xyz/AGENTS.md', '/contacts/c_abc/profile.md'] as const
const CONFIG = buildReadOnlyConfig({
  writablePrefixes: WRITABLE,
  readOnlyExact: RO_EXACT,
  memoryPaths: MEMORY_PATHS,
})

describe('checkWriteAllowed', () => {
  it('returns spec-exact EROFS for /drive/* with drive-propose hint', () => {
    const err = checkWriteAllowed('/drive/refunds/updated.md', CONFIG)
    expect(err).toContain('bash: /drive/refunds/updated.md: Read-only filesystem.')
    expect(err).toContain('organization-scope')
    expect(err).toContain('vobase drive propose --scope=organization --path=/refunds/updated.md --body=...')
  })

  it('includes scope-specific recovery hints for known RO paths', () => {
    const agentsMd = checkWriteAllowed('/agents/a_xyz/AGENTS.md', CONFIG)
    expect(agentsMd).toContain('auto-generated')
    expect(agentsMd).toContain('Instructions')

    const profileMd = checkWriteAllowed('/contacts/c_abc/profile.md', CONFIG)
    expect(profileMd).toContain('Contact profile is derived')

    const STAFF_CFG = buildReadOnlyConfig({
      writablePrefixes: [],
      readOnlyExact: ['/staff/s_1/profile.md'],
    })
    const staffProfile = checkWriteAllowed('/staff/s_1/profile.md', STAFF_CFG)
    expect(staffProfile).toContain('Staff profile is derived')

    const MSG_CFG = buildReadOnlyConfig({
      writablePrefixes: [],
      readOnlyExact: ['/contacts/c_abc/cha_1/messages.md', '/contacts/c_abc/cha_1/internal-notes.md'],
    })
    const messagesMd = checkWriteAllowed('/contacts/c_abc/cha_1/messages.md', MSG_CFG)
    expect(messagesMd).toContain('`reply` tool')
    const notesMd = checkWriteAllowed('/contacts/c_abc/cha_1/internal-notes.md', MSG_CFG)
    expect(notesMd).toContain('Internal notes are derived')
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
