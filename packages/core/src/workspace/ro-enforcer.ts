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

/** Default RO prefixes. `/drive/` gets the special `vobase drive propose` hint. */
const DEFAULT_READ_ONLY_PREFIXES: readonly string[] = ['/drive/']

/** Effective RO/writable configuration consumed by `checkWriteAllowed` and `ScopedFs`. */
export interface ReadOnlyConfig {
  readOnlyPrefixes: readonly string[]
  readOnlyExact: ReadonlySet<string>
  memoryPaths: ReadonlySet<string>
  writablePrefixes: readonly string[]
}

/** Options required to build a `ReadOnlyConfig`. */
export interface BuildReadOnlyConfigOpts {
  /**
   * Prefix allowlist for paths the agent may write. Core ships no defaults —
   * the template declares the writable zones its modules depend on (drive
   * uploads, scratch tmp, etc.) and passes them here.
   */
  writablePrefixes: readonly string[]
  /**
   * Exact RO paths (e.g. per-wake `/agents/<id>/AGENTS.md`, `/contacts/<id>/profile.md`).
   * Template supplies these at wake start since they interpolate nanoids.
   */
  readOnlyExact?: readonly string[]
  /**
   * Memory exact paths (e.g. per-wake `/agents/<id>/MEMORY.md`, `/contacts/<id>/MEMORY.md`).
   * Template supplies these at wake start. Writes to these paths render the
   * `vobase memory …` hint instead of the generic RO error.
   */
  memoryPaths?: readonly string[]
  /** Optional override for RO prefix list. Defaults to `['/drive/']`. */
  readOnlyPrefixes?: readonly string[]
}

/** Builds the RO/writable configuration from template-supplied inputs. */
export function buildReadOnlyConfig(opts: BuildReadOnlyConfigOpts): ReadOnlyConfig {
  return {
    readOnlyPrefixes: opts.readOnlyPrefixes ?? DEFAULT_READ_ONLY_PREFIXES,
    readOnlyExact: new Set(opts.readOnlyExact ?? []),
    memoryPaths: new Set(opts.memoryPaths ?? []),
    writablePrefixes: opts.writablePrefixes,
  }
}

/** Returns `null` if write is allowed, otherwise the spec-exact error message. */
export function checkWriteAllowed(path: string, config: ReadOnlyConfig): string | null {
  // Memory files get their own message.
  if (config.memoryPaths.has(path)) {
    return `bash: ${path}: use \`vobase memory set|append|remove\` to mutate memory safely.`
  }

  // Exact-path RO matches.
  if (config.readOnlyExact.has(path)) {
    return renderRoError(path)
  }

  // Prefix RO matches.
  for (const prefix of config.readOnlyPrefixes) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) {
      return renderRoError(path)
    }
  }

  // Writable prefixes take priority (even inside otherwise-unmatched parents).
  for (const prefix of config.writablePrefixes) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) return null
  }

  // Default-deny: anything not explicitly writable is read-only.
  return `bash: ${path}: Read-only filesystem.`
}

function renderRoError(path: string): string {
  // The error must include the `vobase drive propose …` hint for drive writes.
  if (path.startsWith('/drive/')) {
    const rel = path.slice('/drive'.length)
    return `bash: ${path}: Read-only filesystem.\n  This path is organization-scope (read-only to agents). Use \`vobase drive propose --scope=organization --path=${rel} --body=...\` to suggest a change for staff review.`
  }
  // Known per-wake RO paths get scope-specific recovery hints so the LLM can
  // stop retrying direct writes and reach for the right tool/domain command.
  if (path.endsWith('/AGENTS.md')) {
    return `bash: ${path}: Read-only filesystem.\n  AGENTS.md is auto-generated from the agent definition, registered tools, and CLI reference. Edit the Instructions section in the Agents config page (or update the \`instructions\` column directly) to change agent behavior; do not write to this file.`
  }
  if (path.startsWith('/staff/') && path.endsWith('/profile.md')) {
    return `bash: ${path}: Read-only filesystem.\n  Staff profile is derived from the staff record (display name, role, expertise, timezone). Edit fields in the Team UI; do not write to this file.`
  }
  if (path.startsWith('/contacts/') && path.endsWith('/profile.md')) {
    return `bash: ${path}: Read-only filesystem.\n  Contact profile is derived from the contact record. Edit fields in the Contacts UI or via the contacts service; do not write to this file.`
  }
  if (path.endsWith('/messages.md')) {
    return `bash: ${path}: Read-only filesystem.\n  The conversation timeline is derived from channel events. Use the \`reply\` tool (or \`send_card\`, \`send_file\`) to send a customer-visible message; do not append to this file.`
  }
  if (path.endsWith('/internal-notes.md')) {
    return `bash: ${path}: Read-only filesystem.\n  Internal notes are derived from staff-authored events in the messaging module. This file reflects, but does not accept, new notes.`
  }
  return `bash: ${path}: Read-only filesystem.`
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
  private readonly config: ReadOnlyConfig
  constructor(
    private readonly inner: IFileSystem,
    config: ReadOnlyConfig,
  ) {
    this.config = config
  }

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
    const err = checkWriteAllowed(path, this.config)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.writeFile(path, content, options)
  }
  async appendFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void> {
    const err = checkWriteAllowed(path, this.config)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.appendFile(path, content, options)
  }
  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const err = checkWriteAllowed(path, this.config)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.mkdir(path, options)
  }
  async rm(path: string, options?: RmOptions): Promise<void> {
    const err = checkWriteAllowed(path, this.config)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.rm(path, options)
  }
  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    const err = checkWriteAllowed(dest, this.config)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.cp(src, dest, options)
  }
  async mv(src: string, dest: string): Promise<void> {
    // moving INTO an RO destination is still a write, so reject based on dest.
    const err = checkWriteAllowed(dest, this.config)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.mv(src, dest)
  }
  async chmod(path: string, mode: number): Promise<void> {
    const err = checkWriteAllowed(path, this.config)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.chmod(path, mode)
  }
  async symlink(target: string, linkPath: string): Promise<void> {
    const err = checkWriteAllowed(linkPath, this.config)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.symlink(target, linkPath)
  }
  async link(existingPath: string, newPath: string): Promise<void> {
    const err = checkWriteAllowed(newPath, this.config)
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.link(existingPath, newPath)
  }
  async utimes(path: string, atime: Date, mtime: Date): Promise<void> {
    await this.inner.utimes(path, atime, mtime)
  }
}

/** True if `path` belongs to a writable zone — used by the dirty-tracker. */
export function isWritablePath(
  path: string,
  writablePrefixes: readonly string[],
  memoryPaths: readonly string[] = [],
): boolean {
  for (const prefix of writablePrefixes) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) return true
  }
  // Memory files are writable only through `vobase memory …`, but the CLI
  // privileged path writes them via `innerWriteFile`, so they still count as
  // writable zones when the dirty-tracker enumerates them.
  for (const mp of memoryPaths) {
    if (path === mp) return true
  }
  return false
}
