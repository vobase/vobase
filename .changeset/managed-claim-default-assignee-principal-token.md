---
'@vobase/template': patch
---

fix(template/whatsapp): write `agent:<id>` (not bare id) as the sandbox channel's default assignee

The managed-WhatsApp claim handler was writing the bare `agentDefinitions.id`
into `channel_instances.config.defaultAssignee`, but the canonical principal
token format used by every other writer (`modules/contacts/seed.ts`, the web
instance create form), every reader (`<Principal id=…>`, mention rendering,
hover cards), and the `conversations.assignee` column itself (via
`initialAssignee` in `dispatchInbound`) is `agent:<id>`. The mismatch showed
up in the channels table as a raw 8-character id instead of the agent's
name, and would also have broken assignee resolution on the first inbound
message after claim.

The one downstream reader that strips the `agent:` prefix to do a DB lookup
(`web/service/instances.ts` → `loadHydrationFor`) now strips it uniformly
from both the conversation's assignee and the instance's defaultAssignee,
so the seed flow (`defaultAssignee: 'agent:agt0meri0v1'`) keeps working.
