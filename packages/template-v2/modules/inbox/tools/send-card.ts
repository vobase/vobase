import { Type } from '@mariozechner/pi-ai'
import { appendCardMessage } from '@modules/inbox/service/messages'
import type { AgentTool, ToolContext } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import type { Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

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

function firstError(value: unknown): string {
  const first = Value.Errors(CardElementSchema, value).First()
  return first ? `${first.path || 'root'}: ${first.message}` : 'invalid input'
}

export const sendCardTool: AgentTool<CardElement, { messageId: string }> = {
  name: 'send_card',
  parallelGroup: 'never',
  description:
    'PREFERRED reply format — send a rich interactive card. Use this whenever the customer has options to choose, confirm, compare, or act on (pricing, plans, refund decisions, booking slots, yes/no with consequences, lists of 2+ choices, how-to with a CTA). Cards let the customer one-tap their next move instead of typing. Requires staff approval if agent.cardApprovalRequired=true. Fall back to `reply` only for pure acknowledgements and free-form questions.',
  inputSchema: CardElementSchema,
  requiresApproval: true,

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ messageId: string }>> {
    if (!Value.Check(CardElementSchema, args)) {
      return {
        ok: false,
        error: `Invalid card input — ${firstError(args)}`,
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

    return { ok: true, content: { messageId: msg.id } }
  },
}
