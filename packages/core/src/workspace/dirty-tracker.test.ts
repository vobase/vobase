import { describe, expect, it } from 'bun:test'
import { InMemoryFs } from 'just-bash'
import { DirtyTracker, snapshotFs } from './dirty-tracker'

const WRITABLE = ['/contacts/c_abc/drive/', '/tmp/']
const MEMORY_PATHS = [
  '/agents/a_xyz/MEMORY.md',
  '/contacts/c_abc/MEMORY.md',
  '/staff/u_s1/MEMORY.md',
  '/staff/u_s2/MEMORY.md',
]

describe('DirtyTracker', () => {
  it('tracks added files in writable zones', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir('/contacts/c_abc/drive', { recursive: true })
    await fs.mkdir('/tmp', { recursive: true })
    const snap = await snapshotFs(fs)
    const tracker = new DirtyTracker(snap, WRITABLE, MEMORY_PATHS)

    await fs.writeFile('/contacts/c_abc/drive/new.md', 'body')
    const diff = await tracker.diff(fs)
    expect(diff.added).toContain('/contacts/c_abc/drive/new.md')
    expect(diff.changed).toHaveLength(0)
    expect(diff.deleted).toHaveLength(0)
  })

  it('tracks changed files', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir('/contacts/c_abc/drive', { recursive: true })
    await fs.writeFile('/contacts/c_abc/drive/x.md', 'v1')
    const snap = await snapshotFs(fs)
    const tracker = new DirtyTracker(snap, WRITABLE, MEMORY_PATHS)

    await fs.writeFile('/contacts/c_abc/drive/x.md', 'v2')
    const diff = await tracker.diff(fs)
    expect(diff.changed).toContain('/contacts/c_abc/drive/x.md')
    expect(diff.added).toHaveLength(0)
  })

  it('ignores RO zone changes (drive, agents AGENTS.md, etc.)', async () => {
    const fs = new InMemoryFs()
    await fs.writeFile('/drive/BUSINESS.md', 'v1')
    await fs.writeFile('/agents/a_xyz/AGENTS.md', 'v1')
    const snap = await snapshotFs(fs)
    const tracker = new DirtyTracker(snap, WRITABLE, MEMORY_PATHS)

    await fs.writeFile('/drive/BUSINESS.md', 'v2')
    await fs.writeFile('/agents/a_xyz/AGENTS.md', 'v2')
    const diff = await tracker.diff(fs)
    expect(diff.changed).toHaveLength(0)
    expect(diff.added).toHaveLength(0)
  })

  it('tracks deleted files in writable zones', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir('/contacts/c_abc/drive', { recursive: true })
    await fs.writeFile('/contacts/c_abc/drive/gone.md', 'bye')
    const snap = await snapshotFs(fs)
    const tracker = new DirtyTracker(snap, WRITABLE, MEMORY_PATHS)
    await fs.rm('/contacts/c_abc/drive/gone.md')
    const diff = await tracker.diff(fs)
    expect(diff.deleted).toContain('/contacts/c_abc/drive/gone.md')
  })

  it('classifies scopes for flush()', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir('/contacts/c_abc/drive', { recursive: true })
    await fs.mkdir('/tmp', { recursive: true })
    const snap = await snapshotFs(fs)
    const tracker = new DirtyTracker(snap, WRITABLE, MEMORY_PATHS)

    await fs.writeFile('/contacts/c_abc/drive/doc.md', 'x')
    await fs.writeFile('/contacts/c_abc/MEMORY.md', 'm')
    await fs.writeFile('/agents/a_xyz/MEMORY.md', 'am')
    await fs.writeFile('/tmp/scratch.txt', 's')

    const scoped = await tracker.flush(fs)
    expect(scoped.contactDrive.added).toContain('/contacts/c_abc/drive/doc.md')
    expect(scoped.contactMemory.added).toContain('/contacts/c_abc/MEMORY.md')
    expect(scoped.agentMemory.added).toContain('/agents/a_xyz/MEMORY.md')
    expect(scoped.tmp.added).toContain('/tmp/scratch.txt')
  })

  it('classifies /staff/<id>/MEMORY.md into staffMemory keyed by id', async () => {
    const fs = new InMemoryFs()
    const snap = await snapshotFs(fs)
    const tracker = new DirtyTracker(snap, WRITABLE, MEMORY_PATHS)

    await fs.writeFile('/staff/u_s1/MEMORY.md', 'note one')
    await fs.writeFile('/staff/u_s2/MEMORY.md', 'note two')

    const scoped = await tracker.flush(fs)
    expect(scoped.staffMemory.get('u_s1')?.added).toContain('/staff/u_s1/MEMORY.md')
    expect(scoped.staffMemory.get('u_s2')?.added).toContain('/staff/u_s2/MEMORY.md')
    expect(scoped.staffMemory.size).toBe(2)
  })
})
