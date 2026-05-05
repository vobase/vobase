---
"@vobase/template": patch
---

# Tint composer background when in internal-note mode

The inbox composer uses a single `PromptInput` for both customer reply and internal-note modes, distinguished only by the active tab. Switching to **Note** changed the placeholder and submit label but left the input box visually identical to a customer reply, so it was easy to mistake one for the other at a glance.

Match the composer surface to the note message bubble (`bg-amber-50/70` light, `bg-amber-950/25` dark, `border-amber-500/30`) when `mode === 'note'`. Reply mode is unchanged. Same color tokens already used by `NoteRow` in `message-thread.tsx`, so the composer reads as a draft of the bubble it will produce.
