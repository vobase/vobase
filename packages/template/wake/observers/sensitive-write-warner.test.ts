/**
 * Unit tests for the sensitive-write warner. Drives the listener with a
 * fake `IFileSystem` (in-memory map) and synthesises bash tool-result calls
 * to assert when warnings appear, when they don't, and that they get appended
 * to the existing `stderr` rather than overwriting it.
 */

import { describe, expect, it } from 'bun:test'
import type { OnToolResultCtx } from '@vobase/core'

import { createSensitiveWriteWarner } from './sensitive-write-warner'

interface FakeFs {
  readFile(path: string): Promise<string>
  set(path: string, body: string): void
}

function createFakeFs(initial: Record<string, string> = {}): FakeFs {
  const map = new Map<string, string>(Object.entries(initial))
  return {
    async readFile(path: string): Promise<string> {
      const v = map.get(path)
      if (v === undefined) throw new Error(`fake-fs: not found: ${path}`)
      return v
    },
    set(path: string, body: string) {
      map.set(path, body)
    },
  }
}

const SILENT_LOGGER = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
} as unknown as Parameters<typeof createSensitiveWriteWarner>[0]['logger']

function ctx(
  toolName: string,
  content: { stdout: string; stderr: string; exitCode: number },
  /** Bash command for the call. Defaults to one referencing profile.md so the
   *  warner's cheap short-circuit (`bashMayTouchProfile`) takes the diff path
   *  rather than skipping. Tests for the short-circuit pass an empty command. */
  command = 'sed -i "..." /contacts/c1/profile.md',
): OnToolResultCtx {
  return {
    toolCallId: 'tc1',
    toolName,
    args: { command },
    organizationId: 'org',
    conversationId: 'cv',
    wakeId: 'wk',
    agentId: 'ag',
    turnIndex: 0,
    isError: false,
    result: { ok: true, content },
  } as unknown as OnToolResultCtx
}

const RUNTIME = {} as Parameters<Awaited<ReturnType<typeof createSensitiveWriteWarner>>>[1]

const CONTACT_PROFILE_BEFORE = `---
displayName: "Marc Chen"
marketingOptOut: false
---

# Marc Chen (c1)
`

const CONTACT_PROFILE_GATED_EMAIL = `---
displayName: "Marc Chen"
marketingOptOut: false
email: "marc@personal.io"
---

# Marc Chen (c1)
`

const CONTACT_PROFILE_NONGATED_PHONE = `---
displayName: "Marc Chen"
marketingOptOut: false
phone: "+6598765432"
---

# Marc Chen (c1)
`

describe('sensitive-write-warner — warning behaviour', () => {
  it('skips disk reads when the bash command does not touch any profile path', async () => {
    let reads = 0
    const fs = {
      readFile: (): Promise<string> => {
        reads += 1
        return Promise.resolve('')
      },
    } as unknown as Parameters<typeof createSensitiveWriteWarner>[0]['fs']
    const listener = createSensitiveWriteWarner({ fs, contactId: 'c1', staffIds: ['s1', 's2'], logger: SILENT_LOGGER })
    const out = await listener(ctx('bash', { stdout: '', stderr: '', exitCode: 0 }, 'cat /messages.md'), RUNTIME)
    expect(out).toBeUndefined()
    expect(reads).toBe(0)
  })

  it('falls through to the diff path when bash args are malformed (fail-open)', async () => {
    // Adapter could in theory hand us an args object missing `command` or with
    // a non-string value. The short-circuit must NOT swallow the call — better
    // to do the diff (cost: a few extra reads) than to silently miss a real
    // gated edit. This locks in the "uncertain → assume touched" contract.
    const fs = createFakeFs({ '/contacts/c1/profile.md': CONTACT_PROFILE_BEFORE })
    const listener = createSensitiveWriteWarner({
      fs: fs as never,
      contactId: 'c1',
      staffIds: [],
      logger: SILENT_LOGGER,
    })
    // Prime baseline (also tests args=null tolerance).
    const malformedArgsCtx = {
      ...ctx('bash', { stdout: '', stderr: '', exitCode: 0 }),
      args: null,
    } as unknown as OnToolResultCtx
    await listener(malformedArgsCtx, RUNTIME)
    fs.set('/contacts/c1/profile.md', CONTACT_PROFILE_GATED_EMAIL)
    const numericCommandCtx = {
      ...ctx('bash', { stdout: '', stderr: '', exitCode: 0 }),
      args: { command: 12345 },
    } as unknown as OnToolResultCtx
    const out = await listener(numericCommandCtx, RUNTIME)
    expect(out).toBeDefined()
    const content = (out as { content: { stderr: string } }).content
    expect(content.stderr).toContain('vobase notice')
  })

  it('first call primes baseline with no warning even if file changed externally', async () => {
    const fs = createFakeFs({ '/contacts/c1/profile.md': CONTACT_PROFILE_GATED_EMAIL })
    const listener = createSensitiveWriteWarner({
      fs: fs as never,
      contactId: 'c1',
      staffIds: [],
      logger: SILENT_LOGGER,
    })
    const out = await listener(ctx('bash', { stdout: '', stderr: '', exitCode: 0 }), RUNTIME)
    expect(out).toBeUndefined()
  })

  it('warns when a gated field appears for the first time after the baseline tick', async () => {
    const fs = createFakeFs({ '/contacts/c1/profile.md': CONTACT_PROFILE_BEFORE })
    const listener = createSensitiveWriteWarner({
      fs: fs as never,
      contactId: 'c1',
      staffIds: [],
      logger: SILENT_LOGGER,
    })
    // First tick: prime.
    await listener(ctx('bash', { stdout: '', stderr: '', exitCode: 0 }), RUNTIME)
    // Now agent writes a new gated email. Second tick should warn.
    fs.set('/contacts/c1/profile.md', CONTACT_PROFILE_GATED_EMAIL)
    const out = await listener(ctx('bash', { stdout: 'ok', stderr: '', exitCode: 0 }), RUNTIME)
    expect(out).toBeDefined()
    const content = (out as { content: { stderr: string } }).content
    expect(content.stderr).toContain('vobase notice')
    expect(content.stderr).toContain('email')
    expect(content.stderr).toContain('"marc@personal.io"')
    expect(content.stderr).toContain('queue a PENDING change-proposal')
    expect(content.stderr).toContain('Do NOT tell the customer')
  })

  it('does NOT warn when only non-gated fields change (e.g. phone)', async () => {
    const fs = createFakeFs({ '/contacts/c1/profile.md': CONTACT_PROFILE_BEFORE })
    const listener = createSensitiveWriteWarner({
      fs: fs as never,
      contactId: 'c1',
      staffIds: [],
      logger: SILENT_LOGGER,
    })
    await listener(ctx('bash', { stdout: '', stderr: '', exitCode: 0 }), RUNTIME)
    fs.set('/contacts/c1/profile.md', CONTACT_PROFILE_NONGATED_PHONE)
    const out = await listener(ctx('bash', { stdout: 'ok', stderr: '', exitCode: 0 }), RUNTIME)
    expect(out).toBeUndefined()
  })

  it('does nothing for non-bash tool results', async () => {
    const fs = createFakeFs({ '/contacts/c1/profile.md': CONTACT_PROFILE_BEFORE })
    const listener = createSensitiveWriteWarner({
      fs: fs as never,
      contactId: 'c1',
      staffIds: [],
      logger: SILENT_LOGGER,
    })
    await listener(ctx('bash', { stdout: '', stderr: '', exitCode: 0 }), RUNTIME)
    fs.set('/contacts/c1/profile.md', CONTACT_PROFILE_GATED_EMAIL)
    const out = await listener(ctx('reply', { stdout: '', stderr: '', exitCode: 0 }), RUNTIME)
    expect(out).toBeUndefined()
  })

  it('appends to existing stderr instead of overwriting it', async () => {
    const fs = createFakeFs({ '/contacts/c1/profile.md': CONTACT_PROFILE_BEFORE })
    const listener = createSensitiveWriteWarner({
      fs: fs as never,
      contactId: 'c1',
      staffIds: [],
      logger: SILENT_LOGGER,
    })
    await listener(ctx('bash', { stdout: '', stderr: '', exitCode: 0 }), RUNTIME)
    fs.set('/contacts/c1/profile.md', CONTACT_PROFILE_GATED_EMAIL)
    const out = await listener(
      ctx('bash', { stdout: 'ok', stderr: 'pre-existing stderr line\n', exitCode: 0 }),
      RUNTIME,
    )
    expect(out).toBeDefined()
    const content = (out as { content: { stderr: string } }).content
    expect(content.stderr.startsWith('pre-existing stderr line\n')).toBe(true)
    expect(content.stderr).toContain('vobase notice')
  })

  it('warns on staff profile edits with the staff-record copy variant', async () => {
    const STAFF_BEFORE = `---
displayName: "Bob"
title: "Solutions Engineer"
---

# Bob (s1)
`
    const STAFF_GATED_DISPLAY_NAME = `---
displayName: "Robert Smith"
title: "Solutions Engineer"
---

# Bob (s1)
`
    const fs = createFakeFs({ '/staff/s1/profile.md': STAFF_BEFORE })
    const listener = createSensitiveWriteWarner({
      fs: fs as never,
      contactId: null,
      staffIds: ['s1'],
      logger: SILENT_LOGGER,
    })
    await listener(ctx('bash', { stdout: '', stderr: '', exitCode: 0 }), RUNTIME)
    fs.set('/staff/s1/profile.md', STAFF_GATED_DISPLAY_NAME)
    const out = await listener(ctx('bash', { stdout: 'ok', stderr: '', exitCode: 0 }), RUNTIME)
    expect(out).toBeDefined()
    const content = (out as { content: { stderr: string } }).content
    expect(content.stderr).toContain('Staff records always queue')
    expect(content.stderr).toContain('displayName')
  })

  it('does NOT warn when only attributes.* keys change (those are not gated)', async () => {
    const BEFORE = `---
displayName: "Marc Chen"
marketingOptOut: false
---

# Marc Chen (c1)
`
    const AFTER = `---
displayName: "Marc Chen"
marketingOptOut: false
attributes:
  company: "Northwind"
---

# Marc Chen (c1)
`
    const fs = createFakeFs({ '/contacts/c1/profile.md': BEFORE })
    const listener = createSensitiveWriteWarner({
      fs: fs as never,
      contactId: 'c1',
      staffIds: [],
      logger: SILENT_LOGGER,
    })
    await listener(ctx('bash', { stdout: '', stderr: '', exitCode: 0 }), RUNTIME)
    fs.set('/contacts/c1/profile.md', AFTER)
    const out = await listener(ctx('bash', { stdout: 'ok', stderr: '', exitCode: 0 }), RUNTIME)
    expect(out).toBeUndefined()
  })

  it('truncates long values in the warning so giant frontmatter does not blow up the tool result', async () => {
    const BEFORE = `---
displayName: "Marc"
---

# Marc (c1)
`
    const longEmail = `${'a'.repeat(120)}@example.com`
    const AFTER = `---
displayName: "Marc"
email: "${longEmail}"
---

# Marc (c1)
`
    const fs = createFakeFs({ '/contacts/c1/profile.md': BEFORE })
    const listener = createSensitiveWriteWarner({
      fs: fs as never,
      contactId: 'c1',
      staffIds: [],
      logger: SILENT_LOGGER,
    })
    await listener(ctx('bash', { stdout: '', stderr: '', exitCode: 0 }), RUNTIME)
    fs.set('/contacts/c1/profile.md', AFTER)
    const out = await listener(ctx('bash', { stdout: 'ok', stderr: '', exitCode: 0 }), RUNTIME)
    expect(out).toBeDefined()
    const content = (out as { content: { stderr: string } }).content
    expect(content.stderr).toContain('…')
    expect(content.stderr.length).toBeLessThan(2000)
  })
})
