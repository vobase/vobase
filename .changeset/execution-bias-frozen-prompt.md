---
'@vobase/template': patch
---

Add a static `## Execution Bias` section to the frozen system prompt

The agent had per-turn behavioral guidance (the conversation-lane `# Task`
side-load, which frames *who* to address first) but nothing static and
every-wake encoding *how* to work — explore before acting, finish actionable
requests, ground answers in evidence, vary approach on weak results, continue
until resolved or genuinely blocked, check live state. Agents would jump
straight to a reply off the wake cue without reading the workspace.

`buildFrozenPrompt` now renders an `## Execution Bias` section as its own
`execution-bias` prompt region. It is fully static (no per-wake
interpolation, so `systemHash` stays byte-stable) and reaches every lane,
including standalone wakes. Adapted from openclaw's equivalent section.
