---
"@vobase/core": minor
---

# Typing & Thinking Indicators on Customer Chat + Unified MessageRow

The customer-facing web chat at `/chat/:channelInstanceId` now mirrors the staff inbox: shared avatars, markdown rendering, time dividers, and a single `MessageRow` component drive both surfaces. Adds symmetric typing-presence over the existing SSE bus so each side sees "{name} is typing…" without echoing its own beacons back, plus a derived agent-thinking shimmer that auto-clears the moment any reply lands.

## Typing presence (symmetric)

- Staff composer (`modules/messaging/components/composer.tsx`) fires throttled `POST /api/messaging/conversations/:id/typing` beacons on reply-mode keystroke.
- Customer chat textarea (`src/pages/chat.$channelInstanceId.tsx`) fires the analogous `POST /api/channels/adapters/web/typing`.
- Both route through `notifyTyping(id, userId, userName, actor)` in `modules/messaging/service/staff-ops.ts`, which `pg_notify`s a payload tagged `typing.staff` or `typing.customer` so each side filters out its own.
- Shared constants live in `modules/messaging/lib/typing-actions.ts` (frontend-safe — keeps Drizzle / `node:crypto` out of the browser bundle).
- New `useConversationTyping(conversationId, listenFor)` hook tracks the most recent beacon with a 3s expiry. Presence clears immediately on the next message-arrival event for that conversation, instead of waiting on the timeout.

## Thinking indicator (agent side)

- Derived from message state (`agentThinking`) — true when the last customer message has no subsequent agent/staff reply, or while we're mid-POST, or while an optimistic stub exists. Auto-clears the moment a staff or agent reply lands.
- Public-instance endpoint (`getPublic`) now accepts an optional `?conversationId=` and resolves the agent name from the conversation's actual assignee (`agent:<id>`) before falling back to the channel-level `defaultAssignee`. Instance + conversation lookups run in parallel.
- Indicator renders as a Shimmer strip absolutely positioned above the chat input, so it never reflows the message list when it appears/disappears.

## Inbox lag fix

`modules/channels/adapters/web/handlers/inbound.ts` now fires `notifyConversation(result.conversation.id)` right after `createInboundMessage`. Customer messages render in the staff inbox immediately instead of waiting on the wake's `tool_execution_end` notify (which can be several seconds later).

## Unified MessageRow

New `src/components/message-row.tsx` exports a shared `MessageRow` + `DateDivider`. Both `MessageThread` (staff) and the public chat consume it.

- **Staff scope** passes a `<Principal />` hover-card author label, a `trailingHeader` slot for delivery-status badges, and may inject `bubbleHeader` (agent reasoning) / `bodyOverride` (structured task payloads).
- **Public scope** uses plain-text author labels ("You" / agent name / "Support"), keeps card buttons interactive (`readOnly={false}`), and never imports the staff principal directory (which requires `useStaffList` + `useContactsList`, both staff-only endpoints).

Optimistic outgoing bubbles ship alongside: typed messages and card-button taps push a stub `Message` immediately, deduped against server messages by content via a reducer-style same-ref guard (no observer-loop risk).

Both timelines build an `O(1)` `Map<id, Message>` once per render to look up `card_reply` parent messages instead of `messages.find(...)` per row.

## Card UI polish

- `card-fields.tsx`: bumped field labels and values from `text-xs` (12px) to `text-sm` (14px); changed `grid-cols-2 gap-x-4` to `grid-cols-[max-content_1fr] gap-x-6` so short labels don't steal 50% of the row width.
- `message-card.tsx`: card container `min-w-[220px]` → `min-w-[280px]`, padding `p-3` → `p-4`. Card bubbles in the customer chat widen to `max-w-[92%]` (text bubbles stay at 80%) so fields/buttons get breathing room.
- `card-actions.tsx`: new optional `onOptimisticReply` callback fires before the card-reply POST so taps feel instant.

## Core changes

`RealtimePayload` (`packages/core/src/realtime/index.ts`) gains optional `userId?: string` and `userName?: string` passthrough fields so transient actor signals (currently `typing.*`) can carry identity without a second lookup. Pure additive — existing callers don't need to change.

## Migration

No migration required. The new `RealtimePayload` fields are optional. If you've forked `MessageThread` or wired your own typing presence, the new constants live at `@modules/messaging/lib/typing-actions` and the hook at `@modules/messaging/hooks/use-conversation-typing`.
