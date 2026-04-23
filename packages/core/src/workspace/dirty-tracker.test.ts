import { describe, expect, it } from 'bun:test'
import { InMemoryFs } from 'just-bash'
import { DirtyTracker, snapshotFs } from './dirty-tracker'

describe('DirtyTracker', () => {
  it('tracks added files in writable zones', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir('/workspace/contact/drive', { recursive: true })
    await fs.mkdir('/workspace/tmp', { recursive: true })
    const snap = await snapshotFs(fs)
    const tracker = new DirtyTracker(snap)

    await fs.writeFile('/workspace/contact/drive/new.md', 'body')
    const diff = await tracker.diff(fs)
    expect(diff.added).toContain('/workspace/contact/drive/new.md')
    expect(diff.changed).toHaveLength(0)
    expect(diff.deleted).toHaveLength(0)
  })

  it('tracks changed files', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir('/workspace/contact/drive', { recursive: true })
    await fs.writeFile('/workspace/contact/drive/x.md', 'v1')
    const snap = await snapshotFs(fs)
    const tracker = new DirtyTracker(snap)

    await fs.writeFile('/workspace/contact/drive/x.md', 'v2')
    const diff = await tracker.diff(fs)
    expect(diff.changed).toContain('/workspace/contact/drive/x.md')
    expect(diff.added).toHaveLength(0)
  })

  it('ignores RO zone changes (drive, skills, conversation, etc.)', async () => {
    const fs = new InMemoryFs()
    await fs.writeFile('/workspace/drive/BUSINESS.md', 'v1')
    await fs.writeFile('/workspace/SOUL.md', 'v1')
    const snap = await snapshotFs(fs)
    const tracker = new DirtyTracker(snap)

    await fs.writeFile('/workspace/drive/BUSINESS.md', 'v2')
    await fs.writeFile('/workspace/SOUL.md', 'v2')
    const diff = await tracker.diff(fs)
    expect(diff.changed).toHaveLength(0)
    expect(diff.added).toHaveLength(0)
  })

  it('tracks deleted files in writable zones', async () => {
    const fs = new InMemoryFs()
    await fs.mkdir('/workspace/contact/drive', { recursive: true })
    await fs.writeFile('/workspace/contact/drive/gone.md', 'bye')
    const snap = await snapshotFs(fs)
    const tracker = new DirtyTracker(snap)
    await fs.rm('/workspace/contact/drive/gone.md')
    const diff = await tracker.diff(fs)
    expect(diff.deleted).toContain('/workspace/contact/drive/gone.md')
  })
})
