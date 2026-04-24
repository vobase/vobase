/**
 * Card serialization — types, builders, and serialization for structured cards.
 *
 * Replaces the chat-sdk CardElement primitives with local definitions.
 * Used by send-card tool, card-renderer, and delivery pipeline.
 */

// ─── Card element types ─────────────────────────────────────────────

export interface TextElement {
  type: 'text'
  content: string
  style?: 'bold' | 'muted'
}

export interface ImageElement {
  type: 'image'
  url: string
  alt?: string
}

export interface DividerElement {
  type: 'divider'
}

interface FieldElement {
  type?: 'field'
  label: string
  value: string
}

export interface FieldsElement {
  type: 'fields'
  children: FieldElement[]
}

export interface ButtonElement {
  type: 'button'
  id: string
  label: string
  style?: 'primary' | 'danger' | 'default'
  value?: string
  disabled?: boolean
}

interface LinkButtonElement {
  type: 'link-button'
  url: string
  label: string
}

export interface ActionsElement {
  type: 'actions'
  children: (ButtonElement | LinkButtonElement)[]
}

export interface SectionElement {
  type: 'section'
  children: CardChildElement[]
}

type CardChildElement = TextElement | ImageElement | DividerElement | FieldsElement | ActionsElement | SectionElement

export interface CardElement {
  type: 'card'
  title?: string
  subtitle?: string
  imageUrl?: string
  children: CardChildElement[]
  metadata?: Record<string, unknown>
}

// ─── Builder functions ──────────────────────────────────────────────

export function Card(opts: {
  title?: string
  children: CardChildElement[]
  metadata?: Record<string, unknown>
}): CardElement {
  return { type: 'card', ...opts }
}

export function CardText(content: string): TextElement {
  return { type: 'text', content }
}

export function Actions(children: (ButtonElement | LinkButtonElement)[]): ActionsElement {
  return { type: 'actions', children }
}

export function Button(opts: { id: string; label: string }): ButtonElement {
  return { type: 'button', ...opts }
}

// ─── Type guard ─────────────────────────────────────────────────────
