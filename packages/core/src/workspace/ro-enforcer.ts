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

/**
 * Optional override for RO error messages. Returning `null` falls back to the
 * generic `bash: <path>: Read-only filesystem.` text. Platforms layer their
 * own scope-specific recovery hints (e.g. "use \`vobase drive propose …\`")
 * here so core stays domain-agnostic.
 */
export type RoMessageOverride = (path: string) => string | null

/** Effective RO/writable configuration consumed by `checkWriteAllowed` and `ScopedFs`. */
export interface ReadOnlyConfig {
  readOnlyPrefixes: readonly string[]
  readOnlyExact: ReadonlySet<string>
  memoryPaths: ReadonlySet<string>
  writablePrefixes: readonly string[]
  /**
   * Glob patterns the agent may write — `*` matches one path segment,
   * `**` matches across segments. Wins over the default-deny tier but loses
   * to `readOnlyExact`. See `globToRegExp` for the precise grammar.
   */
  writableGlobs: readonly string[]
  /** Glob patterns explicitly RO. Wins over `writablePrefixes` and `writableGlobs`. */
  readOnlyGlobs: readonly string[]
  /**
   * Paths that are RO to direct `fs.writeFile` writes but writable when the
   * write originates inside a registered CLI verb's `onSideEffect` chain.
   * The `ScopedFs` wrapper surfaces a `withCliContext()` scope for verbs
   * that legitimately mutate these paths (memory, learning proposals, etc.).
   */
  cliWritablePaths: readonly string[]
  /** Platform-supplied RO message hints — see `RoMessageOverride`. */
  roMessageOverride: RoMessageOverride | null
  /** Precompiled regexes for `writableGlobs` — hot path on every write. */
  writableGlobRegexes: readonly RegExp[]
  /** Precompiled regexes for `readOnlyGlobs`. */
  readOnlyGlobRegexes: readonly RegExp[]
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
   * Template supplies these at wake start. Memory files are direct-writable
   * via the workspace-sync observer — `checkWriteAllowed` does not block them.
   * Listed here so the dirty-tracker can enumerate writable memory zones.
   */
  memoryPaths?: readonly string[]
  /** Optional override for RO prefix list. Defaults to `['/drive/']`. */
  readOnlyPrefixes?: readonly string[]
  /** Glob-based writable paths (`*` single segment, `**` recursive). */
  writableGlobs?: readonly string[]
  /** Glob-based RO paths. Wins over writablePrefixes / writableGlobs. */
  readOnlyGlobs?: readonly string[]
  /** Paths writable only from a registered CLI verb's onSideEffect chain. */
  cliWritablePaths?: readonly string[]
  /**
   * Platform-supplied RO message hints. The function receives the path being
   * blocked and returns a domain-specific recovery message, or `null` to fall
   * back to the generic RO error. See `RoMessageOverride` for the contract.
   */
  roMessageOverride?: RoMessageOverride
}

/** Builds the RO/writable configuration from template-supplied inputs. */
export function buildReadOnlyConfig(opts: BuildReadOnlyConfigOpts): ReadOnlyConfig {
  const writableGlobs = opts.writableGlobs ?? []
  const readOnlyGlobs = opts.readOnlyGlobs ?? []
  return {
    readOnlyPrefixes: opts.readOnlyPrefixes ?? DEFAULT_READ_ONLY_PREFIXES,
    readOnlyExact: new Set(opts.readOnlyExact ?? []),
    memoryPaths: new Set(opts.memoryPaths ?? []),
    writablePrefixes: opts.writablePrefixes,
    writableGlobs,
    readOnlyGlobs,
    cliWritablePaths: opts.cliWritablePaths ?? [],
    roMessageOverride: opts.roMessageOverride ?? null,
    writableGlobRegexes: writableGlobs.map(globToRegExp),
    readOnlyGlobRegexes: readOnlyGlobs.map(globToRegExp),
  }
}

/**
 * Compile a glob pattern to a `RegExp`. Supports:
 *   - `**` → matches across path segments (including empty), greedy
 *   - `*`  → matches a single path segment (no `/`)
 * Anything else is taken literally and escaped.
 */
export function globToRegExp(pattern: string): RegExp {
  // Token-by-token parse to keep `**` from being mangled by a `*` pass.
  let out = '^'
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]
    if (c === '*' && pattern[i + 1] === '*') {
      out += '.*'
      i += 1
    } else if (c === '*') {
      out += '[^/]*'
    } else if (c === '?') {
      out += '[^/]'
    } else if (/[.+^${}()|[\]\\]/.test(c ?? '')) {
      out += `\\${c}`
    } else {
      out += c
    }
  }
  out += '$'
  return new RegExp(out)
}

function anyRegexMatches(path: string, regexes: readonly RegExp[]): boolean {
  for (const re of regexes) {
    if (re.test(path)) return true
  }
  return false
}

/**
 * Optional context describing the current write origin. Passed by `ScopedFs`
 * when a CLI verb's `onSideEffect` chain is mutating `cliWritablePaths`.
 */
export interface WriteContext {
  /** Set when the current write originates inside a `vobase` verb. */
  cliVerb?: string | null
}

/**
 * Returns `null` if write is allowed, otherwise the spec-exact error message.
 *
 * Precedence (highest → lowest):
 *   1. Memory paths — direct-writable; the workspace-sync observer flushes the
 *      file body to the owning persistence layer after each turn.
 *   2. Exact RO paths.
 *   3. Glob RO patterns.
 *   4. Prefix RO list.
 *   5. `cliWritablePaths` — allowed iff `ctx.cliVerb` is set.
 *   6. Writable prefixes.
 *   7. Writable glob patterns.
 *   8. Default-deny.
 */
export function checkWriteAllowed(path: string, config: ReadOnlyConfig, ctx?: WriteContext): string | null {
  // 1. Memory files are direct-writable.
  if (config.memoryPaths.has(path)) {
    return null
  }

  // 2. Exact-path RO matches.
  if (config.readOnlyExact.has(path)) {
    return renderRoError(path, config)
  }

  // 3. Glob RO patterns.
  if (anyRegexMatches(path, config.readOnlyGlobRegexes)) {
    return renderRoError(path, config)
  }

  // 4. Prefix RO list.
  for (const prefix of config.readOnlyPrefixes) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) {
      return renderRoError(path, config)
    }
  }

  // 5. cliWritablePaths — allowed only when a CLI verb is the active origin.
  for (const prefix of config.cliWritablePaths) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) {
      if (ctx?.cliVerb) return null
      return `bash: ${path}: Read-only filesystem.\n  This path is mutated only via a registered \`vobase\` verb (e.g. \`vobase drive …\`); direct \`echo > ${path}\` is rejected.`
    }
  }

  // 6. Writable prefixes take priority over the default-deny tier.
  for (const prefix of config.writablePrefixes) {
    if (path === prefix.slice(0, -1) || path.startsWith(prefix)) return null
  }

  // 7. Writable glob patterns.
  if (anyRegexMatches(path, config.writableGlobRegexes)) return null

  // 8. Default-deny: anything not explicitly writable is read-only.
  return `bash: ${path}: Read-only filesystem.`
}

function renderRoError(path: string, config: ReadOnlyConfig): string {
  if (config.roMessageOverride) {
    const override = config.roMessageOverride(path)
    if (override !== null) return override
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
  /**
   * Active CLI verb name when a `vobase` dispatcher is mid-execution. The
   * enforcer reads this to decide whether `cliWritablePaths` can be written.
   * It is intentionally a per-instance mutable field — `withCliContext()`
   * pushes/pops it around the verb's promise.
   */
  private activeCliVerb: string | null = null

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

  /**
   * Run `body` with `activeCliVerb` set to `verb` so `cliWritablePaths`
   * become writable inside the verb. Always restores the previous value,
   * even if `body` throws.
   */
  async withCliContext<T>(verb: string, body: () => Promise<T>): Promise<T> {
    const prior = this.activeCliVerb
    this.activeCliVerb = verb
    try {
      return await body()
    } finally {
      this.activeCliVerb = prior
    }
  }

  /** Snapshot of the current write origin, passed to `checkWriteAllowed`. */
  private writeCtx(): WriteContext {
    return { cliVerb: this.activeCliVerb }
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
    const err = checkWriteAllowed(path, this.config, this.writeCtx())
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.writeFile(path, content, options)
  }
  async appendFile(path: string, content: FileContent, options?: WriteFileOptions | BufferEncoding): Promise<void> {
    const err = checkWriteAllowed(path, this.config, this.writeCtx())
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.appendFile(path, content, options)
  }
  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const err = checkWriteAllowed(path, this.config, this.writeCtx())
    if (err) throw new ReadOnlyFsError(err)
    await this.inner.mkdir(path, options)
  }
  async rm(path: string, options?: RmOptions): Promise<void> {
    const err = checkWriteAllowed(path, this.config, this.writeCtx())
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
    const err = checkWriteAllowed(path, this.config, this.writeCtx())
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
  // Memory files are direct-writable; the workspace-sync observer flushes
  // them via the owning module's persistence layer after each turn. They
  // count as writable zones for dirty-tracker enumeration.
  for (const mp of memoryPaths) {
    if (path === mp) return true
  }
  return false
}
