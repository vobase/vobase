---
"@vobase/template": patch
---

fix(messaging): make the wake conversation authoritative in conversation-scoped CLI verbs

`conv reassign`, `conv set-owner`, and `conv learn` resolved their target as
`input.conversationId ?? ctx.wake?.conversationId`, which let an in-wake agent
override the harness-injected conversation by passing `--conversationId`. In a
production incident an agent passed a channel-instance id (read from a drive file
path) as `--conversationId`; the `conv reassign` customer-ack guard
(`hasRecentAgentReply`) then checked a non-existent conversation, found no reply,
and refused the human handoff twice — stranding the lead on the AI agent.

Flip the precedence so the wake's conversation wins; `--conversationId` is only
honored for out-of-wake HTTP-RPC callers, whose `ctx.wake` is undefined. This
closes the same class of bug in `conv set-owner` (owner set on the wrong
conversation) and `conv learn` (learning pass run on the wrong thread). Adds unit
tests for all three verbs: an in-wake stray `--conversationId` is ignored, and the
out-of-wake fallback is preserved.
