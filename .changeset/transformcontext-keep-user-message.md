---
"@vobase/core": patch
---

Fix `transformContext` dropping the user message when prepending the side-load.

pi-ai's `normalizePromptInput` always stores user-message content as an array of parts (`[{ type: 'text', text }]`), never a bare string. `transformContext` only handled the string case and substituted `''` for array content — so the side-load *replaced* the user's message instead of prefixing it. Agents received the side-load with no actual message and answered the most recent earlier turn (the operator-thread "off-by-one" where each reply addressed the previous message).

`transformContext` now handles array content by prepending the side-load to the first text part, preserving the real message.
