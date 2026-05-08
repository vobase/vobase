---
"@vobase/core": patch
"@vobase/template": patch
"create-vobase": patch
---

Rename the `supervisor` wake trigger to `staff_note`, and drop two pieces of incidental complexity.

1. **Conceptual merge.** `SupervisorKind` (`'coaching' | 'ask_staff_answer'`) is gone — the @-mention of an agent is the only signal that fires a wake; non-mention staff notes flow through the learning-loop triage instead. This removes the classifier, the tool-stripping logic, and the conditional render text that picked between two coaching styles.
2. **Tool `audience` field dropped.** With `SupervisorKind` gone, no caller needs lane-time tool filtering by `audience: 'customer' | 'internal'`; tool `lane` is sufficient.
3. **AGENTS.md preamble trimmed.** Lane-aware contributors gate by `triggerKind` and stay focused — drops ~50% of the per-wake preamble bytes.

Mechanical rename: `WakeTrigger` discriminant `'supervisor'` → `'staff_note'`, `SupervisorWakePayloadSchema` → `StaffNoteWakePayloadSchema`, `MESSAGING_SUPERVISOR_TO_WAKE_JOB` → `MESSAGING_STAFF_NOTE_TO_WAKE_JOB`, file `wake/supervisor.ts` → `wake/staff-note.ts`, smoke file `tests/smoke/smoke-supervisor-action-live.ts` → `tests/smoke/smoke-staff-note-live.ts`. Renderer cue strengthened to clear assignee vs peer-consultation guidance.

Also adds a path-leak prohibition to `messaging/tools/reply.ts`: customer replies must never cite virtual-FS paths (`/drive/...`, `/contacts/...`, `MEMORY.md`, etc.) or internal ids. Seeds dev WhatsApp placeholder credentials in `modules/contacts/seed.ts` so the adapter Zod validation passes for staff-reply paths in dev.
