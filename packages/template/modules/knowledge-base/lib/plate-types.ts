/**
 * Plate Value type definitions, node type constants, factory helpers, and Zod schema.
 *
 * Server-side code MUST only import types from this file — no @platejs/* imports.
 * Client-side code may import @platejs/core types in addition to these.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Core types (mirrors @platejs/core TElement / Value without importing React)
// ---------------------------------------------------------------------------

export interface PlateText {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  code?: boolean
  [key: string]: unknown
}

export interface PlateElement {
  type: string
  children: (PlateElement | PlateText)[]
  [key: string]: unknown
}

/** A Plate document: an ordered array of top-level block elements. */
export type PlateValue = PlateElement[]

// ---------------------------------------------------------------------------
// Node type constants
// ---------------------------------------------------------------------------

export const NodeType = {
  P: 'p',
  H1: 'h1',
  H2: 'h2',
  H3: 'h3',
  H4: 'h4',
  H5: 'h5',
  H6: 'h6',
  BLOCKQUOTE: 'blockquote',
  CODE_BLOCK: 'code_block',
  CODE_LINE: 'code_line',
  HR: 'hr',
  IMG: 'img',
  A: 'a',
  UL: 'ul',
  OL: 'ol',
  LI: 'li',
  LIC: 'lic', // list item content (Plate list plugin convention)
  TABLE: 'table',
  TR: 'tr',
  TD: 'td',
  TH: 'th',
} as const

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function createText(text: string, marks?: Partial<Omit<PlateText, 'text'>>): PlateText {
  return { text, ...marks }
}

export function createParagraph(children: (PlateElement | PlateText)[] = [{ text: '' }]): PlateElement {
  return { type: NodeType.P, children }
}

export function createHeading(
  level: 1 | 2 | 3 | 4 | 5 | 6,
  children: (PlateElement | PlateText)[] = [{ text: '' }],
): PlateElement {
  return { type: `h${level}`, children }
}

export function createBlockquote(children: (PlateElement | PlateText)[] = [{ text: '' }]): PlateElement {
  return { type: NodeType.BLOCKQUOTE, children }
}

export function createCodeBlock(lines: string[], lang?: string): PlateElement {
  const children: PlateElement[] = lines.map((line) => ({
    type: NodeType.CODE_LINE,
    children: [{ text: line }],
  }))
  if (children.length === 0) {
    children.push({ type: NodeType.CODE_LINE, children: [{ text: '' }] })
  }
  return { type: NodeType.CODE_BLOCK, lang: lang ?? '', children }
}

export function createHr(): PlateElement {
  return { type: NodeType.HR, children: [{ text: '' }] }
}

export function createImage(url: string, alt?: string): PlateElement {
  return { type: NodeType.IMG, url, alt: alt ?? '', children: [{ text: '' }] }
}

export function createLink(url: string, children: (PlateElement | PlateText)[] = [{ text: url }]): PlateElement {
  return { type: NodeType.A, url, children }
}

export function createListItem(children: (PlateElement | PlateText)[]): PlateElement {
  // Plate list plugin: li > lic (content) + nested ul/ol (optional)
  return {
    type: NodeType.LI,
    children: [{ type: NodeType.LIC, children }],
  }
}

export function createList(ordered: boolean, items: PlateElement[]): PlateElement {
  return { type: ordered ? NodeType.OL : NodeType.UL, children: items }
}

export function createTableCell(children: (PlateElement | PlateText)[], isHeader = false): PlateElement {
  return {
    type: isHeader ? NodeType.TH : NodeType.TD,
    children: [createParagraph(children)],
  }
}

export function createTableRow(cells: PlateElement[]): PlateElement {
  return { type: NodeType.TR, children: cells }
}

export function createTable(rows: PlateElement[]): PlateElement {
  return { type: NodeType.TABLE, children: rows }
}

// ---------------------------------------------------------------------------
// Zod schema (pragmatic — validates structure without over-constraining)
// ---------------------------------------------------------------------------

const plateTextSchema = z.object({ text: z.string() }).passthrough()

const plateElementSchema: z.ZodType<PlateElement> = z.lazy(() =>
  z
    .object({
      type: z.string(),
      children: z.array(z.union([plateElementSchema, plateTextSchema])).min(1),
    })
    .passthrough(),
)

export const plateValueSchema = z.array(plateElementSchema).min(1)
