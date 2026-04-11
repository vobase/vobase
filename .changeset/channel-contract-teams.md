---
"@vobase/core": minor
---

# Channel Adapter Contract Extensions & Organization Teams

## Channel Adapter Contract

Extended `ChannelAdapter` with six new optional fields for richer channel integration:

| Field | Type | Purpose |
|-------|------|---------|
| `serializeOutbound` | `(message) => OutboundMessage` | Adapter-specific outbound serialization (template, interactive, media routing) |
| `renderContent` | `(text) => string` | Format text for channel (e.g. WhatsApp markdown, email HTML wrapping) |
| `deliveryModel` | `'queued' \| 'realtime'` | Whether messages go through delivery queue or are instant (web) |
| `contactIdentifierField` | `'phone' \| 'email' \| 'identifier'` | Which contact field to use for outbound addressing |
| `debounceWindowMs` | `number` | Per-channel debounce window in ms (WhatsApp: 3000, Email: 30000, Web: 0) |
| `getSessionContext` | `(session) => string \| null` | Format session state for agent prompt injection |

All fields are optional — existing adapters continue to work without changes.

## Channels Service API

Added two new lookup methods to `ChannelsService`:

- **`get(type: string)`** — look up a `ChannelSend` by type name with internal caching. Returns `undefined` if not registered.
- **`getAdapter(type: string)`** — look up the raw `ChannelAdapter` by type name. Returns `undefined` if not registered.

These complement the existing `email` and `whatsapp` convenience properties for dynamic channel access.

## Organization Teams

Added better-auth teams support within organizations:

- New `AuthModuleConfig.teams` option (default: `true`) enables teams within organizations
- New tables: `authTeam` (id, name, organizationId) and `authTeamMember` (id, teamId, userId)
- New session field: `activeTeamId` on `authSession`
- New invitation field: `teamId` on `authInvitation`
- New exports: `authTeam`, `authTeamMember` from `@vobase/core`

## Platform Auth

Default organization creation now uses `VITE_PLATFORM_TENANT_SLUG` env var for the org slug instead of deriving it from the tenant name. Both `VITE_PLATFORM_TENANT_NAME` and `VITE_PLATFORM_TENANT_SLUG` are now required for auto-org creation.

## Test Infrastructure

Updated PGlite test DDL to include `active_team_id` column in session table, matching the schema changes.
