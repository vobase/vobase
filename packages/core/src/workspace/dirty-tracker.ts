/**
 * Dirty tracker — on `agent_end`, diffs the FS against the initial snapshot
 * captured at wake start, returns changed/added/deleted paths under writable
 * zones only.
 *
 * The harness is responsible for dispatching the diff to owning module services.
 * Does NOT call module services — returns the diff so the harness can dispatch.
 *
 * `flush()` extends `diff()` with per-scope categorisation so the
 * `workspaceSyncObserver` can route each path to the correct service without
 * re-implementing the prefix logic.
 */
import type { IFileSystem } from 'just-bash'
import { isWritablePath } from './ro-enforcer'

export interface DirtyDiff {
  changed: string[]
  added: string[]
  deleted: string[]
}

/** Workspace paths bucketed by owning service. */
export interface ScopedDiff {
  /** `/workspace/contact/drive/**` — persisted via FilesService (scope='contact'). */
  contactDrive: DirtyDiff
  /** `/workspace/contact/MEMORY.md` — persisted via ContactsService.upsertNotesSection. */
  contactMemory: DirtyDiff
  /** `/workspace/MEMORY.md` — persisted via AgentsPort working-memory update. */
  agentMemory: DirtyDiff
  /** `/workspace/tmp/**` — ephemeral; caller decides whether to retain. */
  tmp: DirtyDiff
}

function emptyDiff(): DirtyDiff {
  return { changed: [], added: [], deleted: [] }
}

function classifyPath(path: string): keyof ScopedDiff | null {
  if (path.startsWith('/workspace/contact/drive/') || path === '/workspace/contact/drive') {
    return 'contactDrive'
  }
  if (path === '/workspace/contact/MEMORY.md') return 'contactMemory'
  if (path === '/workspace/MEMORY.md') return 'agentMemory'
  if (path.startsWith('/workspace/tmp/') || path === '/workspace/tmp') return 'tmp'
  return null
}

/** Read file content by `IFileSystem` path; returns null if not a file. */
async function safeReadFile(fs: IFileSystem, path: string): Promise<string | null> {
  try {
    const st = await fs.stat(path)
    if (!st.isFile) return null
    return await fs.readFile(path)
  } catch {
    return null
  }
}

export class DirtyTracker {
  constructor(
    private readonly initialSnapshot: ReadonlyMap<string, string>,
    private readonly writablePrefixes: readonly string[],
  ) {}

  /**
   * Returns the raw dirty diff categorised by owning service scope (P2.5).
   * Frozen-snapshot invariant: only call on `agent_end` — never mid-wake.
   */
  async flush(fs: IFileSystem): Promise<ScopedDiff> {
    const raw = await this.diff(fs)
    const out: ScopedDiff = {
      contactDrive: emptyDiff(),
      contactMemory: emptyDiff(),
      agentMemory: emptyDiff(),
      tmp: emptyDiff(),
    }
    for (const p of raw.changed) {
      const k = classifyPath(p)
      if (k) out[k].changed.push(p)
    }
    for (const p of raw.added) {
      const k = classifyPath(p)
      if (k) out[k].added.push(p)
    }
    for (const p of raw.deleted) {
      const k = classifyPath(p)
      if (k) out[k].deleted.push(p)
    }
    return out
  }

  async diff(fs: IFileSystem): Promise<DirtyDiff> {
    const out: DirtyDiff = { changed: [], added: [], deleted: [] }
    const seen = new Set<string>()
    for (const path of fs.getAllPaths()) {
      if (!isWritablePath(path, this.writablePrefixes)) continue
      const now = await safeReadFile(fs, path)
      if (now === null) continue
      seen.add(path)
      const before = this.initialSnapshot.get(path)
      if (before === undefined) {
        out.added.push(path)
      } else if (before !== now) {
        out.changed.push(path)
      }
    }
    for (const [path] of this.initialSnapshot) {
      if (!isWritablePath(path, this.writablePrefixes)) continue
      if (!seen.has(path)) out.deleted.push(path)
    }
    return out
  }
}

/** Helper for test + harness: walks FS once, returns `{ path → content }`. */
export async function snapshotFs(fs: IFileSystem): Promise<Map<string, string>> {
  const snap = new Map<string, string>()
  for (const path of fs.getAllPaths()) {
    const content = await safeReadFile(fs, path)
    if (content !== null) snap.set(path, content)
  }
  return snap
}
