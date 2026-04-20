/**
 * Stub agent — processes `channel-web:inbound-to-wake` jobs without an LLM.
 *
 * Replies to inbound customer messages with a canned, context-shaped response
 * so the web channel can be dogfooded end-to-end. Looks at the most recent
 * customer message kind/text to pick one of:
 *
 *   - plain greeting / short acknowledgement
 *   - pricing card (if the message mentions price / plan / cost)
 *   - refund card (if the message mentions refund / cancel)
 *   - generic help card (fallback — gives the customer tap-reply options)
 *
 * Writes exclusively through the supplied InboxPort so the one-write-path
 * invariant holds. Calls realtime.notify after each write so connected SSE
 * clients pick up the reply.
 */

import { MERIDIAN_AGENT_ID } from '@modules/agents/seed'
import type { InboundToWakePayload } from '@modules/channels/web/jobs'
import type { InboxPort } from '@server/contracts/inbox-port'
import type { RealtimeService } from '@server/contracts/plugin-context'

interface StubAgentDeps {
  inbox: InboxPort
  realtime: RealtimeService
}

const PRICING_CARD = {
  type: 'card',
  title: 'Meridian plans',
  children: [
    { type: 'text', style: 'body', content: 'Pick the plan you want details on:' },
    {
      type: 'fields',
      items: [
        { label: 'Free', value: '$0 · 1 user · 100 tasks/mo' },
        { label: 'Pro', value: '$12/user/mo · unlimited' },
        { label: 'Teams', value: '$24/user/mo · SSO + audit log' },
        { label: 'Enterprise', value: 'Custom · SOC 2 · dedicated CSM' },
      ],
    },
    {
      type: 'actions',
      buttons: [
        { id: 'plan-pro', label: 'Tell me more about Pro', value: 'pro' },
        { id: 'plan-teams', label: 'Compare Teams vs Enterprise', value: 'teams-v-enterprise' },
        { id: 'plan-start', label: 'Start a 14-day trial', value: 'trial' },
      ],
    },
  ],
}

const REFUND_CARD = {
  type: 'card',
  title: 'About refunds',
  children: [
    {
      type: 'text',
      style: 'body',
      content:
        'We offer a 14-day money-back guarantee on the first payment of any paid plan. After 14 days, unused time is credited as prorated account balance.',
    },
    {
      type: 'actions',
      buttons: [
        { id: 'refund-start', label: 'Start a refund request', value: 'start' },
        { id: 'refund-talk', label: 'Talk to billing', value: 'billing' },
      ],
    },
  ],
}

const HELP_CARD = {
  type: 'card',
  title: 'How can I help?',
  children: [
    { type: 'text', style: 'body', content: 'Pick a topic and I can jump straight in:' },
    {
      type: 'actions',
      buttons: [
        { id: 'help-pricing', label: 'Pricing', value: 'pricing' },
        { id: 'help-integrations', label: 'Integrations', value: 'integrations' },
        { id: 'help-refund', label: 'Refunds & billing', value: 'refund' },
        { id: 'help-human', label: 'Talk to a human', value: 'human' },
      ],
    },
  ],
}

function classify(text: string): 'greeting' | 'pricing' | 'refund' | 'help' {
  const t = text.toLowerCase()
  if (/\b(price|pricing|plan|cost|quote|how much)\b/.test(t)) return 'pricing'
  if (/\b(refund|cancel|cancellation|money[- ]back)\b/.test(t)) return 'refund'
  if (/^(hi|hello|hey|yo|sup|good (morning|afternoon|evening))\b/.test(t.trim())) return 'greeting'
  return 'help'
}

function cardReplyText(buttonValue: string): string | null {
  const map: Record<string, string> = {
    pro: 'Pro is $12/user/mo — unlimited tasks, integrations (Slack, GitHub, Google Calendar), and priority support. 14-day free trial, no card required.',
    'teams-v-enterprise':
      'Teams ($24/user/mo) adds SSO, audit log, and team workspaces. Enterprise adds SOC 2 reports, a dedicated CSM, and custom contracting — pricing is tailored per org.',
    trial: 'You can start the trial at meridian.app/trial — it lasts 14 days and includes every Pro feature.',
    start:
      "Thanks — I've flagged a refund for you. A human teammate will follow up within one business day with the refund confirmation.",
    billing: 'Looping in our billing team now. Carol handles refunds and typically replies within a few hours.',
    pricing: 'Happy to show you — here are the four plans and what sits in each:',
    integrations:
      'We integrate with Slack, GitHub, Google Calendar, and Zapier (Pro and above). Anything specific you want to connect?',
    refund: 'Sure — let me pull up the refund policy:',
    human: "I'll let a teammate know you'd prefer a human — someone will jump in shortly.",
  }
  return map[buttonValue] ?? null
}

export function createStubAgentHandler(deps: StubAgentDeps) {
  return async function handleInboundToWake(rawData: unknown): Promise<void> {
    const data = rawData as InboundToWakePayload
    const messages = await deps.inbox.listMessages(data.conversationId, { limit: 1 })
    const last = messages[messages.length - 1]
    if (!last) return
    if (last.role !== 'customer') return

    const wakeId = `stub-wake:${data.messageId}`

    if (last.kind === 'card_reply') {
      const content = last.content as { buttonValue?: string }
      const reply = cardReplyText(content.buttonValue ?? '')
      if (!reply) return
      const msg = await deps.inbox.sendTextMessage({
        conversationId: data.conversationId,
        organizationId: data.organizationId,
        author: { kind: 'agent', id: MERIDIAN_AGENT_ID },
        body: reply,
        wakeId,
      })
      deps.realtime.notify({ table: 'messages', id: msg.id, action: 'INSERT' })
      deps.realtime.notify({ table: 'conversations', id: data.conversationId, action: 'UPDATE' })
      return
    }

    if (last.kind !== 'text') return
    const text = String((last.content as { text?: unknown })?.text ?? '')
    const intent = classify(text)

    if (intent === 'greeting') {
      const msg = await deps.inbox.sendTextMessage({
        conversationId: data.conversationId,
        organizationId: data.organizationId,
        author: { kind: 'agent', id: MERIDIAN_AGENT_ID },
        body: "Hey! I'm Meridian's support assistant. What can I help you with today?",
        wakeId,
      })
      deps.realtime.notify({ table: 'messages', id: msg.id, action: 'INSERT' })
      // Follow up with a quick-reply card so the customer has one-tap paths.
      const card = await deps.inbox.sendCardMessage({
        conversationId: data.conversationId,
        organizationId: data.organizationId,
        author: { kind: 'agent', id: MERIDIAN_AGENT_ID },
        card: HELP_CARD,
        wakeId,
      })
      deps.realtime.notify({ table: 'messages', id: card.id, action: 'INSERT' })
      deps.realtime.notify({ table: 'conversations', id: data.conversationId, action: 'UPDATE' })
      return
    }

    if (intent === 'pricing') {
      const msg = await deps.inbox.sendCardMessage({
        conversationId: data.conversationId,
        organizationId: data.organizationId,
        author: { kind: 'agent', id: MERIDIAN_AGENT_ID },
        card: PRICING_CARD,
        wakeId,
      })
      deps.realtime.notify({ table: 'messages', id: msg.id, action: 'INSERT' })
      deps.realtime.notify({ table: 'conversations', id: data.conversationId, action: 'UPDATE' })
      return
    }

    if (intent === 'refund') {
      const msg = await deps.inbox.sendCardMessage({
        conversationId: data.conversationId,
        organizationId: data.organizationId,
        author: { kind: 'agent', id: MERIDIAN_AGENT_ID },
        card: REFUND_CARD,
        wakeId,
      })
      deps.realtime.notify({ table: 'messages', id: msg.id, action: 'INSERT' })
      deps.realtime.notify({ table: 'conversations', id: data.conversationId, action: 'UPDATE' })
      return
    }

    // Fallback: acknowledge + show the help card.
    const ack = await deps.inbox.sendTextMessage({
      conversationId: data.conversationId,
      organizationId: data.organizationId,
      author: { kind: 'agent', id: MERIDIAN_AGENT_ID },
      body: "Got it — let me get you to the right place. Here's what I can help with:",
      wakeId,
    })
    deps.realtime.notify({ table: 'messages', id: ack.id, action: 'INSERT' })
    const card = await deps.inbox.sendCardMessage({
      conversationId: data.conversationId,
      organizationId: data.organizationId,
      author: { kind: 'agent', id: MERIDIAN_AGENT_ID },
      card: HELP_CARD,
      wakeId,
    })
    deps.realtime.notify({ table: 'messages', id: card.id, action: 'INSERT' })
    deps.realtime.notify({ table: 'conversations', id: data.conversationId, action: 'UPDATE' })
  }
}
