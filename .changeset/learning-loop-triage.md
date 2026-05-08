---
"@vobase/template": minor
"create-vobase": minor
---

Learning loop slice 2: agent-driven learning loop with triage pipeline.

Adds the cheap-model triage pre-filter that runs before any expensive learning operation (full distill, skill emission, memory rewrite). Triage classifies the signal, scopes it (`agent.agent_memory` / `team.staff_memory` / `contacts.contact_memory` / `agents.learned_skill`), and either drops, queues, or fans out to the matching observer. Drops never leave a row; queued candidates land in a typed table for staff visibility; auto-applied lessons go through the same `change_proposals` machinery as everything else, so confidence + sensitivity routing applies uniformly.

Wire-up: `wake/learning/triage.ts` runs as a post-wake job, and the existing learning observers (`coaching_note`, `staff_takeover`, `coexistence_echo`, `rejection`, `learned_skill`, `contact_memory`, `staff_memory`) now consume only triage-classified candidates. New `learning_candidates` table tracks pending vs consumed rows.
