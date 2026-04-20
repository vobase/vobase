/**
 * Read-only enforcement for writable zone discipline.
 *
 * Wraps `just-bash`'s `InMemoryFs` in a custom `ScopedFs` that intercepts writes
 * to RO paths. `OverlayFs({readOnly:true})` requires a real root directory; our
 * virtual workspace has none, so a write-intercepting wrapper around `InMemoryFs`
 * is the cleanest match. The wrapper throws a sanitized Error whose message matches
 * the expected EROFS text, and `just-bash`'s built-in commands surface that message
 * via stderr + non-zero exit code when `echo > …` redirects fail.
 */
import type { BufferEncoding, CpOptions, FileContent, FsStat, IFileSystem, MkdirOptions, RmOptions } from 'just-bash'

// `ReadFileOptions`, `WriteFileOptions`, and `DirentEntry` are not re-exported
// from `just-bash`'s public entry; redeclare the minimal shapes we use.
type ReadFileOptions = { encoding?: BufferEncoding | null }
type WriteFileOptions = { encoding?: BufferEncoding }
interface DirentEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
}

/** RO paths. Absolute-path prefixes or literal paths. */
const READ_ONLY_PREFIXES: readonly string[] = ['/workspace/drive/', '/workspace/skills/', '/workspace/conversation/']

const READ_ONLY_EXACT: ReadonlySet<string> = new Set([
  '/workspace/SOUL.md',
  '/workspace/AGENTS.md',
  '/workspace/contact/profile.md',
  '/workspace/contact/bookings.md',
])

/** Memory files are writable ONLY via `vobase memory …`, not direct `echo >`. */
const MEMORY_PATHS: ReadonlySet<string> = new Set(['/workspace/MEMORY.md', '/workspace/contact/MEMORY.md'])

/**
 * Writable zone allowlist (for dirty-tracking). Anything under these prefixes
 * is legal to write. Direct writes outside both allowlist and RO list are
 * rejected — defense-in-depth against stray writes (e.g. `echo > /workspace/evil`).
 */
export const WRITABLE_PREFIXES: readonly string[] = ['/workspace/contact/drive/', '/workspace/tmp/']

/** Returns `null` if write is allowed, otherwise the spec-exact error message. */
export function checkWriteAllowed(path: string): string | null {
  // Memory files get their own message.
  if (MEMORY_PATHS.has(path)) {
    return `bash: ${path}: use \`vobase memory set|append|remove\` to mutate memory safely.`
  }

  // Exact-path RO matches.
  if (READ_ONLY_EXACT.has(path)) {
    return renderRoError(path)
  }

  // Prefix RO matches.
  for (const prefix of READ_ONLY_PREFIXES) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) {
      return renderRoError(path)
    }
  }

  // Writable prefixes take priority (even inside otherwise-unmatched parents).
  for (const prefix of WRITABLE_PREFIXES) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) return null
  }

  // Allow workspace top-level writes (e.g. creating tmp/) but nothing escaping /workspace.
  if (!path.startsWith('/workspace/') && path !== '/workspace') {
    return `bash: ${path}: Read-only filesystem.`
  }

  return null
}

function renderRoError(path: string): string {
  // The error must include the `vobase drive propose …` hint
  // and should render the path as the agent wrote it.
  const scope = 'organization'
  const rel = path.startsWith('/workspace/drive/')
    ? path.slice('/workspace/drive'.length)
    : path.slice('/workspace'.length)
  return `bash: ${path}: Read-only filesystem.\n  Use \`vobase drive propose --scope=${scope} --path=${rel} --body=...\` to suggest an addition.`
}

/** The error class `just-bash` surfaces to stderr when redirect writes fail. */
export class ReadOnlyFsError extends Error {
  override readonly name = 'ReadOnlyFsError'
}

/**
 * Wraps an `IFileSystem` and rejects writes to RO paths. Reads/listings
 * pass through unmodified so the agent can `ls`, `cat`, `grep` freely.
 *
 * The materialization path (harness writes during workspace construction) uses
 * the underlying `InMemoryFs` directly via `innerWriteFile` — bypassing the
 * enforcer. Only routes the LLM hits go through `writeFile` on this wrapper.
 */
export class ScopedFs implements IFileSystem {
  constructor(private readonly inner: IFileSystem) {}

  /** Allow harness-controlled code to perform privileged writes. */
  async innerWriteFile(path: string, content: FileContent): Promise<void> {
    await this.inner.writeFile(path, content)
  }

  // ---- Read-through (identity) ----
  readFile(path: string, options?: ReadFileOptions | BufferEncoding): Promise<string> {
    return this.inner.readFile(path, options)
  }
  readFileBuffer(path: string): Promise<Uint8Array> {
    return this.inner.readFileBuffer(path)
  }
  exists(path: string): Promise<boolean> {
    return this.inner.exists(path)
  }
  stat(path: string): Promise<FsStat> {
    return this.inner.stat(path)
  }
  lstat(path: string): Promise<FsStat> {
    return this.inner.lstat(path)
  }
  readdir(path: string): Promise<string[]> {
    return this.inner.readdir(path)
  }
  readdirWithFileTypes(path: string): Promise<DirentEntry[]> {
    if (this.inner.readdirWithFileTypes) return this.inner.readdirWithFileTypes(path)
    return Promise.resolve([])
  }
  resolvePath(base: string, path: string): string {
    return this.inner.resolvePath(base, path)
  }
  getAllPaths(): string[] {
    return this.inner.getAllPaths()
  }
  readlink(path: string): Promise<string> {
    return this.inner.readlink(path)
  }
  realpath(path: string): Promise<string> {
    return this.inner.realpath(path)
  }

  // ---- Write-intercepting ----
  async writeFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void> {
    const err = checkWriteAllowed(path)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.writeFile(path, content, options)
  }
  async appendFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void> {
    const err = checkWriteAllowed(path)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.appendFile(path, content, options)
  }
  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const err = checkWriteAllowed(path)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.mkdir(path, options)
  }
  async rm(path: string, options?: RmOptions): Promise<void> {
    const err = checkWriteAllowed(path)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.rm(path, options)
  }
  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const err = checkWriteAllowed(dest)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.cp(src, dest, options)
  }
  async mv(src: string, dest: string): Promise<void> {
    // moving INTO an RO destination is still a write, so reject based on dest.
    const err = checkWriteAllowed(dest)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.mv(src, dest)
  }
  async chmod(path: string, mode: number): Promise<void> {
    const err = checkWriteAllowed(path)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.chmod(path, mode)
  }
  async symlink(target: string, linkPath: string): Promise<void> {
    const err = checkWriteAllowed(linkPath)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.symlink(target, linkPath)
  }
  async link(existingPath: string, newPath: string): Promise<void> {
    const err = checkWriteAllowed(newPath)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.link(existingPath, newPath)
  }
  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    await this.inner.utimes(path, atime, mtime)
  }
}

/** True if `path` belongs to a writable zone — used by the dirty-tracker. */
export function isWritablePath(path: string): boolean {
  for (const prefix of WRITABLE_PREFIXES) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) return true
  }
  // Memory files are writable only through `vobase memory …`, but the CLI
  // privileged path writes them via `innerWriteFile`, so they still count as
  // writable zones when the dirty-tracker enumerates them.
  if (path === '/workspace/MEMORY.md' || path === '/workspace/contact/MEMORY.md') return true
  return false
}
