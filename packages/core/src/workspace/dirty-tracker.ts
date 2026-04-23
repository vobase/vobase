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
  /** `/contacts/<id>/drive/**` — persisted via FilesService (scope='contact'). */
  contactDrive: DirtyDiff
  /** `/contacts/<id>/MEMORY.md` — persisted via ContactsService.upsertNotesSection. */
  contactMemory: DirtyDiff
  /** `/agents/<id>/MEMORY.md` — persisted via AgentsPort working-memory update. */
  agentMemory: DirtyDiff
  /**
   * `/staff/<staffId>/MEMORY.md` — persisted via AgentsPort.upsertStaffMemory.
   * Keyed by staffId so the dispatcher can upsert per row.
   */
  staffMemory: Map<string, DirtyDiff>
  /** `/tmp/**` — ephemeral; caller decides whether to retain. */
  tmp: DirtyDiff
}

function emptyDiff(): DirtyDiff {
  return { changed: [], added: [], deleted: [] }
}

const CONTACT_DRIVE_RE = /^\/contacts\/[^/]+\/drive(?:\/|$)/
const CONTACT_MEMORY_RE = /^\/contacts\/[^/]+\/MEMORY\.md$/
const AGENT_MEMORY_RE = /^\/agents\/[^/]+\/MEMORY\.md$/
const STAFF_MEMORY_RE = /^\/staff\/([^/]+)\/MEMORY\.md$/

type Classification =
  | { kind: 'contactDrive' | 'contactMemory' | 'agentMemory' | 'tmp' }
  | { kind: 'staffMemory'; staffId: string }

function classifyPath(path: string): Classification | null {
  if (CONTACT_DRIVE_RE.test(path)) return { kind: 'contactDrive' }
  if (CONTACT_MEMORY_RE.test(path)) return { kind: 'contactMemory' }
  if (AGENT_MEMORY_RE.test(path)) return { kind: 'agentMemory' }
  const staffMatch = path.match(STAFF_MEMORY_RE)
  if (staffMatch) return { kind: 'staffMemory', staffId: staffMatch[1] }
  if (path.startsWith('/tmp/') || path === '/tmp') return { kind: 'tmp' }
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
    private readonly memoryPaths: readonly string[] = [],
  ) {}

  /**
   * Returns the raw dirty diff categorised by owning service scope.
   * Frozen-snapshot invariant: only call on `agent_end` — never mid-wake.
   */
  async flush(fs: IFileSystem): Promise<ScopedDiff> {
    const raw = await this.diff(fs)
    const out: ScopedDiff = {
      contactDrive: emptyDiff(),
      contactMemory: emptyDiff(),
      agentMemory: emptyDiff(),
      staffMemory: new Map<string, DirtyDiff>(),
      tmp: emptyDiff(),
    }
    const getStaffBucket = (staffId: string): DirtyDiff => {
      let existing = out.staffMemory.get(staffId)
      if (!existing) {
        existing = emptyDiff()
        out.staffMemory.set(staffId, existing)
      }
      return existing
    }
    const push = (path: string, lane: keyof DirtyDiff): void => {
      const c = classifyPath(path)
      if (!c) return
      if (c.kind === 'staffMemory') {
        getStaffBucket(c.staffId)[lane].push(path)
        return
      }
      out[c.kind][lane].push(path)
    }
    for (const p of raw.changed) push(p, 'changed')
    for (const p of raw.added) push(p, 'added')
    for (const p of raw.deleted) push(p, 'deleted')
    return out
  }

  async diff(fs: IFileSystem): Promise<DirtyDiff> {
    const out: DirtyDiff = { changed: [], added: [], deleted: [] }
    const seen = new Set<string>()
    for (const path of fs.getAllPaths()) {
      if (!isWritablePath(path, this.writablePrefixes, this.memoryPaths)) continue
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
      if (!isWritablePath(path, this.writablePrefixes, this.memoryPaths)) continue
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
