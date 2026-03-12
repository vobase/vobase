---
"@vobase/core": minor
---

Add RBAC support with role guards, API key auth, and optional organization/team support. Reorganize core source into mcp/ and infra/ subdirectories. Add module-aware MCP CRUD tools with API key authentication. Schema tables for apikey (always), organization/member/invitation (opt-in).

### New features

- **better-auth plugins**: Wire `@better-auth/api-key` (always) and `organization` (opt-in via `config.auth.organization`) plugins into the auth module
- **RBAC middlewares**: `requireRole()`, `requirePermission()`, `requireOrg()` exported from `@vobase/core` for route-level authorization
- **API key auth for MCP**: MCP endpoint validates API keys via `Authorization: Bearer <key>`. Discovery tools available without auth; CRUD tools require valid API key.
- **MCP CRUD tools**: Auto-generated list/get/create/update/delete tools per module from Drizzle schema, gated on API key authentication
- **Organization support**: Opt-in via `config.auth.organization` — adds organization, member, invitation tables
- **Permission contracts**: `Permission` and `OrganizationContext` TypeScript interfaces

### Breaking changes

- `AuthUser` and `VobaseUser` types now include optional `activeOrganizationId` field
- `AuthModule` type now includes `verifyApiKey()` and `organizationEnabled` fields
- `McpDeps` interface now accepts optional `verifyApiKey` and `organizationEnabled`
- Core source files moved: `src/mcp.ts` → `src/mcp/server.ts`, `src/errors.ts` → `src/infra/errors.ts`, etc. (barrel re-exports preserve public API)
- New peer dependency: `@better-auth/api-key@^1.5.0`
