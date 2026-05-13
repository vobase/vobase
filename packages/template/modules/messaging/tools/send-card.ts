import { sendOutbound, throwIfFailed } from '@modules/channels/service/outbound'
import { type Static, Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { AgentTool, ToolContext, ToolResult } from '@vobase/core'

import { appendCardMessage } from '../service/messages'

const ButtonStyle = Type.Union([Type.Literal('primary'), Type.Literal('danger'), Type.Literal('default')])
const TextStyle = Type.Union([Type.Literal('plain'), Type.Literal('bold'), Type.Literal('muted')])
const ActionType = Type.Union([Type.Literal('action'), Type.Literal('modal')])

const ButtonElement = Type.Object({
  type: Type.Literal('button'),
  id: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  style: Type.Optional(ButtonStyle),
  value: Type.Optional(Type.String()),
  disabled: Type.Optional(Type.Boolean()),
  actionType: Type.Optional(ActionType),
})

const LinkButtonElement = Type.Object({
  type: Type.Literal('link-button'),
  url: Type.String({ format: 'uri' }),
  label: Type.String({ minLength: 1 }),
  style: Type.Optional(ButtonStyle),
})

const TextElement = Type.Object({
  type: Type.Literal('text'),
  content: Type.String(),
  style: Type.Optional(TextStyle),
})

const ImageElement = Type.Object({
  type: Type.Literal('image'),
  url: Type.String({ format: 'uri' }),
  alt: Type.Optional(Type.String()),
})

const DividerElement = Type.Object({ type: Type.Literal('divider') })

const FieldElement = Type.Object({
  type: Type.Literal('field'),
  label: Type.String(),
  value: Type.String(),
})

const FieldsElement = Type.Object({
  type: Type.Literal('fields'),
  children: Type.Array(FieldElement, { minItems: 1, maxItems: 10 }),
})

const LinkElement = Type.Object({
  type: Type.Literal('link'),
  url: Type.String({ format: 'uri' }),
  label: Type.String(),
})

const ActionsElement = Type.Object({
  type: Type.Literal('actions'),
  children: Type.Array(Type.Union([ButtonElement, LinkButtonElement]), { minItems: 1, maxItems: 10 }),
})

const CardChild = Type.Union([TextElement, ImageElement, DividerElement, ActionsElement, FieldsElement, LinkElement])

export const CardElementSchema = Type.Object({
  type: Type.Literal('card'),
  title: Type.Optional(Type.String()),
  subtitle: Type.Optional(Type.String()),
  imageUrl: Type.Optional(Type.String({ format: 'uri' })),
  children: Type.Array(CardChild, { minItems: 1, maxItems: 20 }),
})

export type CardElement = Static<typeof CardElementSchema>

const CHILD_SCHEMAS: Record<string, typeof TextElement> = {
  text: TextElement,
  image: ImageElement,
  divider: DividerElement,
  actions: ActionsElement,
  fields: FieldsElement,
  link: LinkElement,
} as unknown as Record<string, typeof TextElement>

const ALLOWED_CHILD_TYPES = Object.keys(CHILD_SCHEMAS).join(', ')

function describeErrors(value: unknown): string {
  const root = value as { children?: unknown[] }
  if (Array.isArray(root?.children)) {
    for (let i = 0; i < root.children.length; i++) {
      const child = root.children[i] as { type?: string }
      const t = child?.type
      if (!t || !(t in CHILD_SCHEMAS)) {
        return `children/${i}: invalid or missing "type" (got ${JSON.stringify(t)}). Allowed card child types: ${ALLOWED_CHILD_TYPES}. Buttons and link-buttons must be wrapped inside an {type:"actions", children:[...]} element.`
      }
      const schema = CHILD_SCHEMAS[t]
      const err = Value.Errors(schema, child).First()
      if (err) return `children/${i} (${t}): ${err.path || 'root'} ${err.message}`
    }
  }
  const first = Value.Errors(CardElementSchema, value).First()
  return first ? `${first.path || 'root'}: ${first.message}` : 'invalid input'
}

export const sendCardTool: AgentTool<CardElement, { messageId: string }> = {
  name: 'send_card',
  parallelGroup: 'never',
  lane: 'conversation',
  description:
    'Send a rich interactive card. Card children must be one of: text, image, divider, actions, fields, link. Buttons and link-buttons are NEVER top-level children — wrap them in {type:"actions", children:[{type:"button",...}|{type:"link-button",...}]}. Example: {type:"card", title:"Pro plan", children:[{type:"text", content:"$12/user/mo"}, {type:"actions", children:[{type:"button", id:"buy", label:"Upgrade", style:"primary"}, {type:"button", id:"later", label:"Not now"}]}]}. Requires staff approval if agent.cardApprovalRequired=true.',
  inputSchema: CardElementSchema,
  requiresApproval: true,
  prompt:
    'Send a structured card with choices, buttons, or fields for customer-facing interactive decisions (pricing, plans, refund options, booking slots). Reach for this when the response has structure or actionable choices — otherwise use `reply`. Only call when a customer message is pending and unanswered; never to react to an internal note, staff coaching, or your own prior wake. Before firing, scan "Your recent actions" in the wake cue: if an equivalent card was already sent in response to the current inbound, do not re-fire (rewriting a few words to bypass this check is still a duplicate).',

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ messageId: string }>> {
    if (!Value.Check(CardElementSchema, args)) {
      return {
        ok: false,
        error: `Invalid card input — ${describeErrors(args)}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }

    const msg = await appendCardMessage({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      card: args,
    })

    const result = await sendOutbound({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      persisted: { id: msg.id },
      toolName: 'send_card',
      payload: args,
    })
    throwIfFailed(result, 'send_card')

    return { ok: true, content: { messageId: msg.id } }
  },
}
