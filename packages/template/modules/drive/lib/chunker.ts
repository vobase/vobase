/**
 * Markdown chunker.
 *
 * Splits a markdown document into ~512-token chunks with 64-token overlap.
 * Token estimate is simple `chars / 4` — accurate enough for embedding-budget
 * gating without dragging tiktoken into the bundle.
 *
 * Strategy: split on paragraph boundaries (`\n\n`), then accumulate paragraphs
 * up to the cap. When a single paragraph exceeds the cap, it's hard-split on
 * sentence boundaries (period/question-mark/exclam) and finally on raw char
 * count if a sentence is itself oversized.
 */

const DEFAULT_MAX_TOKENS = 512
const DEFAULT_OVERLAP_TOKENS = 64
const CHARS_PER_TOKEN = 4

export interface ChunkOptions {
  maxTokens?: number
  overlapTokens?: number
}

export interface Chunk {
  index: number
  content: string
  tokenCount: number
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Hard-split a single oversized paragraph along sentence boundaries first, char count fallback. */
function splitParagraph(p: string, maxChars: number): string[] {
  if (p.length <= maxChars) return [p]
  const sentenceParts: string[] = []
  let buffer = ''
  // Naive sentence boundary — fine for chunk-merging where we don't need linguistic accuracy.
  for (const piece of p.split(/(?<=[.!?])\s+/)) {
    if (!piece) continue
    if ((buffer + piece).length > maxChars && buffer.length > 0) {
      sentenceParts.push(buffer.trim())
      buffer = piece
    } else {
      buffer = buffer.length > 0 ? `${buffer} ${piece}` : piece
    }
  }
  if (buffer.trim().length > 0) sentenceParts.push(buffer.trim())

  // Char-count fallback for any sentence still over the cap.
  const result: string[] = []
  for (const part of sentenceParts) {
    if (part.length <= maxChars) {
      result.push(part)
      continue
    }
    for (let i = 0; i < part.length; i += maxChars) {
      result.push(part.slice(i, i + maxChars))
    }
  }
  return result
}

/** Trailing-token overlap — used as a prefix on the next chunk for embedding continuity. */
function tailOverlap(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length === 0) return ''
  if (text.length <= overlapChars) return text
  // Round to the nearest whitespace to avoid splitting mid-word.
  const slice = text.slice(text.length - overlapChars)
  const ws = slice.indexOf(' ')
  return ws >= 0 ? slice.slice(ws + 1) : slice
}

/** Chunk a markdown document into ~maxTokens windows with `overlapTokens` of trailing overlap. */
export function chunkMarkdown(markdown: string, opts?: ChunkOptions): Chunk[] {
  const maxTokens = opts?.maxTokens ?? DEFAULT_MAX_TOKENS
  const overlapTokens = opts?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS
  const maxChars = maxTokens * CHARS_PER_TOKEN
  const overlapChars = overlapTokens * CHARS_PER_TOKEN

  const trimmed = markdown.trim()
  if (trimmed.length === 0) return []

  const paragraphs = trimmed.split(/\n{2,}/u).filter((p) => p.trim().length > 0)
  const chunks: Chunk[] = []
  let buffer = ''
  let lastTail = ''

  const flush = () => {
    const content = buffer.trim()
    if (content.length === 0) return
    const overlay = lastTail.length > 0 ? `${lastTail}\n\n${content}` : content
    chunks.push({
      index: chunks.length,
      content: overlay,
      tokenCount: estimateTokens(overlay),
    })
    lastTail = tailOverlap(content, overlapChars)
    buffer = ''
  }

  for (const raw of paragraphs) {
    const parts = splitParagraph(raw, maxChars)
    for (const part of parts) {
      if (buffer.length === 0) {
        buffer = part
        continue
      }
      const candidate = `${buffer}\n\n${part}`
      if (candidate.length > maxChars) {
        flush()
        buffer = part
      } else {
        buffer = candidate
      }
    }
  }
  flush()

  return chunks
}
