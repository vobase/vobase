---
"@vobase/template": minor
---

# Contact attributes in PROFILE, learning controls, history toast, and two fixes

A batch of generic helpdesk improvements.

- **Contact attribute schema in PROFILE.md** — the contact PROFILE now renders the tenant's attribute-definition schema (key, label, type, options, example), so the agent proposes `attributes.*` edits against attributes that actually exist instead of guessing keys.
- **`LEARN_AUTO_TRIAGE` kill-switch** — an opt-out env switch that disables the automatic learning-triage producers (self-reflection, coaching notes, staff takeover, proposal rejection, coexistence echoes) without a code change. Defaults on; the triage job and candidate side-load stay wired so manual triggers still work.
- **Manual "learn from this thread" trigger** — staff can send a conversation through the learning loop on demand from the conversation detail view or a `conv learn` CLI verb, via a new `'manual'` learning-signal kind that bypasses the kill-switch and debounce window.
- **Live WhatsApp history-import toast** — a top-right toast tracks coexistence chat-history import progress, backed by a `/history-sync` projection over `whatsapp_history_chunks`.
- **Fix: `field_set 'segments'` accepts a single string** — previously a string value silently wiped segments to `[]` while reporting success; now a string is wrapped to a one-element array, an array is written verbatim, null clears, and anything else throws.
- **Fix: channel disconnect/release errors surface** — the disconnect mutation now toasts an actionable message (role hint on a 403, generic retry otherwise) instead of failing silently with the confirm dialog stuck open.
