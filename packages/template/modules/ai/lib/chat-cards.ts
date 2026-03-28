/**
 * Card builder utilities for structured WhatsApp messages.
 *
 * Uses chat-sdk's Card/Button/Actions primitives to create CardElements
 * that the bridge adapter serializes to templates, interactive buttons,
 * or text fallbacks.
 */
import type { CardElement } from 'chat';
import { Actions, Button, Card, CardText } from 'chat';

// ─── WhatsApp limits ─────────────────────────────────────────────────

const MAX_BUTTON_TITLE = 20;
const MAX_BODY_TEXT = 1024;
const MAX_REPLY_BUTTONS = 3;

// ─── Template card ───────────────────────────────────────────────────

/**
 * Build a CardElement representing a WhatsApp template message.
 *
 * The bridge detects template metadata in the card's children and
 * serializes to OutboundMessage.template.
 */
export function buildTemplateCard(
  templateName: string,
  language: string,
  parameters?: string[],
): CardElement {
  // Store template params in the card structure for bridge detection
  // Bridge's serializeCard checks for metadata.template on card children
  const card = Card({
    title: `Template: ${templateName}`,
    children: [
      CardText(
        `Language: ${language}${parameters?.length ? ` | Params: ${parameters.join(', ')}` : ''}`,
      ),
    ],
  });

  // Attach template metadata for bridge serialization
  (card as unknown as Record<string, unknown>).metadata = {
    template: { name: templateName, language, parameters },
  };

  return card;
}

// ─── Interactive card ────────────────────────────────────────────────

interface InteractiveButton {
  id: string;
  title: string;
}

/**
 * Build a CardElement with interactive reply buttons.
 * WhatsApp supports max 3 reply buttons with 20-char titles.
 * The bridge serializes this to OutboundMessage.metadata.interactive.
 *
 * If >3 buttons provided, only first 3 are used as interactive buttons.
 */
export function buildInteractiveCard(
  title: string,
  body: string,
  buttons: InteractiveButton[],
): CardElement {
  // Enforce WhatsApp limits
  const truncatedBody = body.slice(0, MAX_BODY_TEXT);
  const actionButtons = buttons.slice(0, MAX_REPLY_BUTTONS).map((btn) =>
    Button({
      id: `chat:${JSON.stringify(btn.id)}`,
      label: btn.title.slice(0, MAX_BUTTON_TITLE),
    }),
  );

  return Card({
    title,
    children: [
      CardText(truncatedBody),
      ...(actionButtons.length > 0 ? [Actions(actionButtons)] : []),
    ],
  });
}

// ─── Text card (no buttons) ──────────────────────────────────────────

/**
 * Build a simple text card with title and body (no buttons).
 * The bridge serializes this to OutboundMessage.text.
 */
export function buildTextCard(title: string, body: string): CardElement {
  return Card({
    title,
    children: [CardText(body)],
  });
}
