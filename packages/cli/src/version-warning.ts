// Warn-once is a module-level boolean — no persisted state, resets per process.
let warned = false

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((s) => Number.parseInt(s, 10))
  const pb = b.split('.').map((s) => Number.parseInt(s, 10))
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export interface VersionWarningOpts {
  installed: string
  latest: string | undefined
  stderr?: (s: string) => void
}

export function maybeWarnVersionSkew(opts: VersionWarningOpts): void {
  if (warned) return
  const { installed, latest } = opts
  if (!latest) return
  if (compareVersions(installed, latest) >= 0) return
  warned = true
  const write = opts.stderr ?? ((s: string) => process.stderr.write(s))
  write(`[vobase] WARN: vobase ${installed} is behind ${latest}; upgrade with 'bun add -g @vobase/cli'\n`)
}

export function __resetVersionWarningForTests(): void {
  warned = false
}
