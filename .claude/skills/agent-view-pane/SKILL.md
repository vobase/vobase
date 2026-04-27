---
name: agent-view-pane
description: |
  Per-page Agent View pane pattern — show staff what an agent sees about the current entity (contact / agent / staff member). Use this skill when adding an "Agent View" panel to a new detail page, building a per-module agent-view RPC route, or debugging why the pane is empty. Also use when the user says "agent view", "what does the agent see", "materialized files for X", "expose AGENTS.md to staff", or "show MEMORY.md for this contact".
---

# Agent View pane

Slice 1 retired the global `/workspace` shell. Materialized files (AGENTS.md, MEMORY.md, profile.md) now surface per-page through `<AgentViewPane scope={...} />`, mounted on each entity's detail route. The pane is collapsed by default; expanding it fetches the materialized files via a module-typed RPC and renders them as accordion-style sections.

## When to apply

- Adding a new entity type whose materialized files staff want to inspect (contact, agent, staff member, channel, …).
- Wiring an existing detail page to the same agent-view surface.

Skip when there's nothing scope-specific to show — a global resources page belongs in `/resources`, not behind a per-entity pane.

## Anatomy

### Server side

Each module exposes a `GET /:id/agent-view` route that returns a uniform shape:

```ts
// modules/<module>/handlers/agent-view.ts
const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/:id/agent-view', async (c) => {
    const id = c.req.param('id')
    const organizationId = c.get('organizationId')
    const row = await svc.get(id)
    if (row.organizationId !== organizationId) return c.json({ error: 'not_found' }, 404)
    const files: Array<{ path: string; title: string; content: string }> = []
    if (row.someMd) files.push({ path: '/X.md', title: 'X.md', content: row.someMd })
    return c.json({ scope: `/<kind>/${id}`, files })
  })
```

Mount via the existing handlers/index.ts:

```ts
.route('/', agentViewHandler)
```

The Hono RPC client picks up the new route automatically — `contactsClient[':id']['agent-view'].$get(...)` is typed once the module's default export is re-derived.

### Frontend

```tsx
import { AgentViewPane } from '@/components/agent-view-pane'

<section className="shrink-0 border-border border-b px-6 py-4">
  <AgentViewPane scope={`/contacts/${id}`} />
</section>
```

Supported scopes:

- `/contacts/<contactId>` — profile.md + MEMORY.md (notes column)
- `/agents/<agentId>` — AGENTS.md (instructions) + MEMORY.md (workingMemory) + skills/* placeholders
- `/staff/<userId>` — one MEMORY.md per agent that has accumulated memory about the staff member

The pane is collapsed by default; the underlying TanStack Query is `enabled: false` until the user expands it.

## Adding a new scope

1. Add a route in the module's handlers (`handlers/agent-view.ts`) that returns the `{ scope, files }` shape.
2. Mount it via `.route('/', agentViewHandler)` in `handlers/index.ts`.
3. In `src/components/agent-view-pane.tsx`, extend `runFetch` with a new `kind` branch and call the typed RPC client.
4. Mount `<AgentViewPane scope={...} />` on the detail page.

## Empty state

When `data.files.length === 0`, the pane renders a shadcn `<Empty>` with a friendly "no observations yet" message. Don't replace this with a custom centered `<div>` — `Empty` already handles spacing, icon, and dark-mode contrast.

## What to avoid

- Don't expose write operations through this pane. Agent View is read-only; mutations belong on the source forms (contact form, agent settings, etc.).
- Don't fetch agent-view eagerly on every page render — keep `enabled: open` so collapsed panes don't hit the server.
- Don't bake module-specific UI into the component. The pane renders any `{ scope, files }` payload uniformly; if your scope needs richer rendering, lift it into the per-module page.
