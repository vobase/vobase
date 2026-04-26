/**
 * Format-aware file readers for declarative resources.
 *
 * Each format returns the raw `body` payload object (still untyped). The
 * caller validates the body against the resource's Zod schema.
 */

import type { ResourceFormat } from './types'

function requireBun(): typeof Bun {
  const candidate = (globalThis as { Bun?: typeof Bun }).Bun
  if (!candidate) {
    throw new Error(
      'declarative: Bun runtime is required (Bun.YAML / Bun.CryptoHasher / Bun.file). Run via `bun` rather than `node` — or split out the YAML/SHA helpers if you need a Node-friendly path.',
    )
  }
  return candidate
}

const parseYaml = (s: string): unknown => requireBun().YAML.parse(s)
const stringifyYaml = (v: unknown): string => requireBun().YAML.stringify(v)

export interface RawParseResult {
  /** Untyped body, ready for `bodySchema.safeParse`. */
  body: unknown
  /** The exact bytes the parser hashed — useful for content-addressed checks. */
  hashableContent: string
}

/**
 * Parse a file's bytes according to its declared format.
 *
 * Markdown-frontmatter: `---\n<yaml>\n---\n<markdown>` → body =
 * `{ ...frontmatter, content: '<markdown>' }`. The `content` slot is reserved
 * for the post-frontmatter body so consumers don't accidentally pick a
 * frontmatter key named `content`.
 */
export function parseFileBytes(format: ResourceFormat, content: string): RawParseResult {
  switch (format) {
    case 'yaml': {
      const body = parseYaml(content)
      return { body, hashableContent: content }
    }
    case 'markdown-frontmatter': {
      const parsed = splitFrontmatter(content)
      const front = parsed.frontmatter ? (parseYaml(parsed.frontmatter) as Record<string, unknown> | null) : null
      const body = { ...(front ?? {}), content: parsed.body }
      return { body, hashableContent: content }
    }
    default: {
      const exhaustive: never = format
      throw new Error(`parseFileBytes: unsupported format "${String(exhaustive)}"`)
    }
  }
}

/** Inverse for `markdown-frontmatter`: produce file bytes from a typed body. */
export function serializeMarkdownFrontmatter<T extends Record<string, unknown>>(body: T): string {
  const { content, ...frontmatter } = body as T & { content?: string }
  const yaml = stringifyYaml(frontmatter as unknown).trim()
  return `---\n${yaml}\n---\n\n${content ?? ''}`.replace(/\n+$/, '\n')
}

/** Inverse for `yaml`: produce stable yaml bytes from a typed body. */
export function serializeYaml<T>(body: T): string {
  return stringifyYaml(body as unknown)
}

interface FrontmatterSplit {
  frontmatter: string | null
  body: string
}

function splitFrontmatter(content: string): FrontmatterSplit {
  if (!content.startsWith('---')) return { frontmatter: null, body: content }
  const end = content.indexOf('\n---', 3)
  if (end === -1) return { frontmatter: null, body: content }
  const frontmatter = content.slice(3, end).replace(/^\r?\n/, '')
  const after = content.slice(end + 4)
  // Strip the conventional blank line between frontmatter and body so the
  // body is the markdown a reader sees.
  const body = after.replace(/^\r?\n+/, '')
  return { frontmatter, body }
}
