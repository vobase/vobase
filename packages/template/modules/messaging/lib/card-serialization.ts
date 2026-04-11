/**
 * Card serialization — types, builders, and serialization for structured cards.
 *
 * Replaces the chat-sdk CardElement primitives with local definitions.
 * Used by send-card tool, card-renderer, and delivery pipeline.
 */

// ─── Card element types ─────────────────────────────────────────────

export interface TextElement {
  type: 'text';
  content: string;
  style?: 'bold' | 'muted';
}

export interface ImageElement {
  type: 'image';
  url: string;
  alt?: string;
}

export interface DividerElement {
  type: 'divider';
}

interface FieldElement {
  type?: 'field';
  label: string;
  value: string;
}

export interface FieldsElement {
  type: 'fields';
  children: FieldElement[];
}

export interface ButtonElement {
  type: 'button';
  id: string;
  label: string;
  style?: 'primary' | 'danger' | 'default';
  value?: string;
  disabled?: boolean;
}

interface LinkButtonElement {
  type: 'link-button';
  url: string;
  label: string;
}

export interface ActionsElement {
  type: 'actions';
  children: (ButtonElement | LinkButtonElement)[];
}

export interface SectionElement {
  type: 'section';
  children: CardChildElement[];
}

type CardChildElement =
  | TextElement
  | ImageElement
  | DividerElement
  | FieldsElement
  | ActionsElement
  | SectionElement;

export interface CardElement {
  type: 'card';
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  children: CardChildElement[];
  metadata?: Record<string, unknown>;
}

// ─── Builder functions ──────────────────────────────────────────────

export function Card(opts: {
  title?: string;
  children: CardChildElement[];
  metadata?: Record<string, unknown>;
}): CardElement {
  return { type: 'card', ...opts };
}

export function CardText(content: string): TextElement {
  return { type: 'text', content };
}

export function Actions(
  children: (ButtonElement | LinkButtonElement)[],
): ActionsElement {
  return { type: 'actions', children };
}

export function Button(opts: { id: string; label: string }): ButtonElement {
  return { type: 'button', ...opts };
}

// ─── Type guard ─────────────────────────────────────────────────────

// ─── Serialization ──────────────────────────────────────────────────

interface SerializedOutput {
  content: string;
  payload?:
    | {
        template?: { name: string; language: string; parameters?: string[] };
        interactive?: Record<string, unknown>;
      }
    | undefined;
}

/** Serialize a CardElement to outbox content + payload. */
export function serializeCard(card: unknown): SerializedOutput {
  const cardObj = card as Record<string, unknown>;

  const metadata = (cardObj.metadata ?? {}) as Record<string, unknown>;

  // Card with template metadata → WhatsApp template
  if (metadata.template) {
    const tmpl = metadata.template as {
      name: string;
      language: string;
      parameters?: string[];
    };
    return {
      content: `[Template: ${tmpl.name}]`,
      payload: { template: tmpl },
    };
  }

  // Card with action buttons → WhatsApp interactive reply buttons
  const children = (cardObj.children ?? []) as unknown[];
  const buttons = extractActionButtons(children);

  if (buttons.length > 0 && buttons.length <= 3) {
    const interactive = {
      type: 'button',
      body: { text: extractCardText(cardObj) },
      action: {
        buttons: buttons.map((btn) => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: String(btn.title).slice(0, 20),
          },
        })),
      },
    };
    return {
      content: cardToTextFallback(cardObj, buttons),
      payload: { interactive },
    };
  }

  // Card without usable buttons → text fallback
  return { content: cardToTextFallback(cardObj, buttons) };
}

// ─── Card helpers ──────────────────────────────────────────────────

interface ButtonInfo {
  id: string;
  title: string;
}

/** Extract action buttons from card children. */
function extractActionButtons(children: unknown[]): ButtonInfo[] {
  const buttons: ButtonInfo[] = [];
  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const el = child as Record<string, unknown>;
    const type = el.type as string | undefined;

    // ActionsElement: { type: 'actions', children: ButtonElement[] }
    if (type === 'actions') {
      const actionChildren = (el.children ?? []) as unknown[];
      for (const btn of actionChildren) {
        if (!btn || typeof btn !== 'object') continue;
        const btnEl = btn as Record<string, unknown>;
        if (btnEl.type === 'button' && btnEl.id) {
          buttons.push({
            id: String(btnEl.id),
            title: String(btnEl.label ?? ''),
          });
        }
      }
    }

    // Direct ButtonElement: { type: 'button', id, label }
    if (type === 'button' && el.id) {
      buttons.push({
        id: String(el.id),
        title: String(el.label ?? ''),
      });
    }
  }
  return buttons;
}

/** Extract readable text from card (title + text children). */
function extractCardText(cardObj: Record<string, unknown>): string {
  const parts: string[] = [];
  const title = cardObj.title as string | undefined;
  if (title) parts.push(title);

  // Extract text from TextElement children
  const children = (cardObj.children ?? []) as unknown[];
  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const el = child as Record<string, unknown>;
    if (el.type === 'text' && el.content) {
      parts.push(String(el.content));
    }
  }
  return parts.join('\n') || '';
}

function cardToTextFallback(
  cardObj: Record<string, unknown>,
  buttons: ButtonInfo[],
): string {
  const parts: string[] = [];
  const text = extractCardText(cardObj);
  if (text) parts.push(text);
  if (buttons.length > 0) {
    parts.push('');
    for (const btn of buttons) {
      parts.push(`• ${btn.title}`);
    }
  }
  return parts.join('\n');
}
