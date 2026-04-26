/**
 * Generic index-file builder — the layered renderer that powers
 * `AGENTS.md`, `INDEX.md`, and any future workspace summary file.
 *
 * Contributors register themselves with a target file, a priority, and a
 * `render(ctx)` callback that produces a `string | null`. The builder sorts
 * by priority (low number first), filters out null/empty sections, and
 * concatenates with a single blank line between sections.
 *
 * Determinism: equal-priority contributors render in registration order, so
 * a stable boot sequence yields a stable file. This is load-bearing for the
 * frozen-snapshot invariant — re-running `build()` between turns of the
 * same wake must produce a byte-identical document.
 */

export interface IndexContributorContext {
  /** File the contributor is rendering for (e.g. `AGENTS.md`, `INDEX.md`). */
  file: string
  /** Per-render bag for cross-contributor data. Builder leaves empty by default. */
  scratch?: Record<string, unknown>
}

export interface IndexContributor {
  /** Target file name — contributors only fire for matching builds. */
  file: string
  /** Lower numbers render earlier. Convention: 0 = preamble, 100 = body, 999 = footer. */
  priority: number
  /** Optional human-friendly tag for diagnostics + collision messages. */
  name?: string
  render(ctx: IndexContributorContext): string | null
}

export interface BuildIndexFileOpts {
  file: string
  /** Optional per-build context fan-out into each contributor. */
  scratch?: Record<string, unknown>
}

/**
 * Stateful registry. `IndexFileBuilder` is intentionally per-wake (or
 * per-test) — sharing one across wakes risks ordering coupling between
 * unrelated boots. Each wake constructs its own builder and registers the
 * relevant contributors before the first `build()` call.
 */
export class IndexFileBuilder {
  private readonly entries: IndexContributor[] = []

  /** Register one contributor. Returns `this` for chaining. */
  register(contributor: IndexContributor): this {
    this.entries.push(contributor)
    return this
  }

  /** Convenience: register many at once. */
  registerAll(contributors: readonly IndexContributor[]): this {
    for (const c of contributors) this.entries.push(c)
    return this
  }

  /** Build the document for `opts.file`. Joins non-empty sections with `\n\n`. */
  build(opts: BuildIndexFileOpts): string {
    const subset = this.entries.filter((e) => e.file === opts.file)
    // Stable sort by priority then registration order (already preserved by Array.filter).
    subset.sort((a, b) => a.priority - b.priority)
    const ctx: IndexContributorContext = { file: opts.file, scratch: opts.scratch }
    const parts: string[] = []
    for (const c of subset) {
      const out = c.render(ctx)
      if (out === null) continue
      const trimmed = out.replace(/\s+$/u, '')
      if (trimmed.length === 0) continue
      parts.push(trimmed)
    }
    return parts.join('\n\n')
  }
}

/**
 * Module-side helper: define a contributor without exposing the builder
 * directly. Modules pass the result up to whatever wires the per-wake
 * `IndexFileBuilder.register()` calls.
 */
export function defineIndexContributor(contributor: IndexContributor): IndexContributor {
  return contributor
}
