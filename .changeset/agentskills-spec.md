---
"@vobase/template": minor
"create-vobase": minor
---

Learning loop slice 3: `agentskills.io` skill spec + signal × scope smoke coverage.

Aligns the learned-skill format with the public `agentskills.io` spec (frontmatter + body convention), updates the skill-emission path to write that shape, and adds smoke coverage exercising every `(signalKind, scope)` pair from the triage pipeline so the cheap-model classifier and the routing rules are tested as a matrix instead of as one happy-path scenario per signal.
