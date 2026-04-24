import type { IFileSystem } from 'just-bash'

import type { CustomSideLoadMaterializer } from './side-load-collector'

export interface CreateAgentsMdChainOpts {
  /**
   * Returns the directories the agent touched in the last turn (absolute paths,
   * no trailing slash). Template typically derives this from bash history via
   * {@link deriveTouchedDirsFromBashHistory}, but any source is fine.
   */
  touchedDirsProvider: () => readonly string[]
  /** Filesystem to read AGENTS.md files from. */
  fs: IFileSystem
  /**
   * Walk ancestor chains up to and excluding this root prefix. Defaults to `/`
   * (walk all the way up). Set e.g. to `/drive` to restrict the chain to a
   * single subtree.
   */
  rootStop?: string
  /** Filename to collect in each ancestor directory. Defaults to `AGENTS.md`. */
  filename?: string
  /**
   * Paths to ignore — typically the per-wake `/agents/<agentId>/AGENTS.md`,
   * which is already in the frozen system prompt and must not be re-injected
   * here.
   */
  ignorePaths?: readonly string[]
  /** Max hints block size (in bytes). Defaults to 16KB. */
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 16 * 1024

/**
 * Per-turn side-load: walks ancestors of each "touched directory" for any
 * `AGENTS.md` file, dedupes across the wake, and injects them as `## Context
 * hints` so staff-authored guidance in `/drive/policies/billing/AGENTS.md`
 * surfaces the moment the agent reads a doc in that subtree.
 *
 * Dedup is *cumulative across the wake*: a file appears at most once per wake,
 * regardless of how often the agent revisits its subtree. Pairs with the
 * frozen-snapshot invariant — re-injection would thrash the provider cache.
 */
export function createAgentsMdChainContributor(opts: CreateAgentsMdChainOpts): CustomSideLoadMaterializer {
  const filename = opts.filename ?? 'AGENTS.md'
  const rootStop = opts.rootStop ?? '/'
  const ignore = new Set(opts.ignorePaths ?? [])
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const emitted = new Set<string>()

  return {
    kind: 'custom',
    priority: 50,
    contribute: async () => {
      const dirs = opts.touchedDirsProvider()
      if (dirs.length === 0) return ''

      const candidatePaths = collectAncestorChain(dirs, filename, rootStop)
      const fresh: { path: string; body: string }[] = []
      let used = 0
      for (const path of candidatePaths) {
        if (ignore.has(path) || emitted.has(path)) continue
        let exists = false
        try {
          exists = await opts.fs.exists(path)
        } catch {
          exists = false
        }
        if (!exists) continue
        let body = ''
        try {
          body = await opts.fs.readFile(path, 'utf8')
        } catch {
          continue
        }
        const block = `### ${path}\n\n${body.trim()}\n`
        if (used + block.length > maxBytes) break
        emitted.add(path)
        fresh.push({ path, body: block })
        used += block.length
      }
      if (fresh.length === 0) return ''
      return `## Context hints (from AGENTS.md files in dirs touched this turn)\n\n${fresh.map((f) => f.body).join('\n')}`.trimEnd()
    },
  }
}

/**
 * Ancestor paths for each touched dir, deepest first within a chain, chains
 * visited in touched-dir order. The starter dir's own `AGENTS.md` is included.
 * Paths under (or equal to) `rootStop` are dropped.
 */
function collectAncestorChain(dirs: readonly string[], filename: string, rootStop: string): string[] {
  const stop = normalizeRoot(rootStop)
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of dirs) {
    const dir = normalizeDir(raw)
    if (!dir) continue
    let cursor = dir
    while (cursor.length > 0 && (stop === '/' ? true : cursor.startsWith(stop))) {
      const candidate = joinPath(cursor, filename)
      if (!seen.has(candidate)) {
        seen.add(candidate)
        out.push(candidate)
      }
      if (cursor === '/') break
      const parent = cursor.slice(0, cursor.lastIndexOf('/')) || '/'
      if (parent === cursor) break
      if (stop !== '/' && !parent.startsWith(stop)) break
      cursor = parent
    }
  }
  return out
}

function normalizeDir(p: string): string {
  if (!p) return ''
  if (!p.startsWith('/')) return ''
  if (p === '/') return '/'
  return p.endsWith('/') ? p.slice(0, -1) : p
}

function normalizeRoot(p: string): string {
  if (!p || p === '/') return '/'
  return p.endsWith('/') ? p.slice(0, -1) : p
}

function joinPath(dir: string, name: string): string {
  if (dir === '/') return `/${name}`
  return `${dir}/${name}`
}

/**
 * Best-effort parser: walks a list of bash commands and extracts directories
 * the agent inspected or wrote into. Recognizes `ls`, `cat`, `head`, `tail`,
 * `grep`, `find`, `tree`, `rg`, `stat`, `wc`, `cd`, `mkdir`, `touch`, `rm`,
 * `cp`, `mv`, and file-write redirections (`> /path/x`, `>> /path/x`).
 * Shell substitutions (`$(...)`, `\``), pipes, and compound commands are
 * ignored beyond the first recognizable token — the parser is advisory, not
 * comprehensive.
 */
export function deriveTouchedDirsFromBashHistory(history: readonly string[]): string[] {
  const dirs = new Set<string>()
  for (const raw of history) {
    for (const cmd of splitShell(raw)) {
      const dir = inferDirFromCommand(cmd)
      if (dir) dirs.add(dir)
    }
  }
  return [...dirs]
}

const READ_VERBS = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'find', 'tree', 'rg', 'stat', 'wc', 'cd', 'file'])
const WRITE_VERBS = new Set(['mkdir', 'touch', 'rm', 'cp', 'mv', 'chmod', 'ln'])

function inferDirFromCommand(cmd: string): string | null {
  const trimmed = cmd.trim()
  if (!trimmed) return null
  // Redirection: pick the target of `>` / `>>`.
  const redirect = trimmed.match(/>>?\s*("(?:[^"\\]|\\.)*"|'[^']*'|\S+)/)
  if (redirect) {
    const target = unquote(redirect[1])
    const dir = parentDir(target)
    if (dir) return dir
  }
  const [verb, ...args] = tokenize(trimmed)
  if (!verb) return null
  const verbName = verb.replace(/^sudo$/, '')
  if (!READ_VERBS.has(verbName) && !WRITE_VERBS.has(verbName)) return null
  // First non-flag argument.
  for (const a of args) {
    if (a.startsWith('-')) continue
    const path = unquote(a)
    if (!path.startsWith('/')) continue
    if (verbName === 'cd' || verbName === 'ls' || verbName === 'find' || verbName === 'tree' || verbName === 'mkdir') {
      return path.endsWith('/') && path !== '/' ? path.slice(0, -1) : path
    }
    const parent = parentDir(path)
    if (parent) return parent
  }
  return null
}

function splitShell(line: string): string[] {
  // Split on `;`, `&&`, `||` at top level; keep pipes inside one command since
  // the first token still identifies the operation.
  const parts: string[] = []
  let buf = ''
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      buf += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      buf += ch
      continue
    }
    if (ch === ';') {
      parts.push(buf)
      buf = ''
      continue
    }
    if ((ch === '&' && line[i + 1] === '&') || (ch === '|' && line[i + 1] === '|')) {
      parts.push(buf)
      buf = ''
      i++
      continue
    }
    buf += ch
  }
  if (buf.trim()) parts.push(buf)
  return parts
}

function tokenize(line: string): string[] {
  const out: string[] = []
  let buf = ''
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      else buf += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ' ' || ch === '\t') {
      if (buf) {
        out.push(buf)
        buf = ''
      }
      continue
    }
    buf += ch
  }
  if (buf) out.push(buf)
  return out
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

function parentDir(p: string): string | null {
  if (!p.startsWith('/')) return null
  if (p === '/') return '/'
  const trimmed = p.endsWith('/') ? p.slice(0, -1) : p
  const idx = trimmed.lastIndexOf('/')
  if (idx <= 0) return '/'
  return trimmed.slice(0, idx)
}
