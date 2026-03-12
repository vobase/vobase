---
"@vobase/core": minor
---

Add RBAC support with role guards, API key auth, and optional organization/team support. Reorganize core source into mcp/ and infra/ subdirectories. Add module-aware MCP CRUD tools. Schema tables for apikey (always), organization/member/invitation (opt-in).

### New features

- **RBAC middlewares**: `requireRole()`, `requirePermission()`, `requireOrg()` for declarative route-level authorization
- **API key schema**: Always included in `getActiveSchemas()` for MCP and programmatic access
- **Organization support**: Opt-in via `getActiveSchemas({ organization: true })` — adds organization, member, invitation tables
- **MCP CRUD tools**: Auto-generated list/get/create/update/delete tools per module from Drizzle schema
- **Permission contracts**: `Permission` and `OrganizationContext` TypeScript interfaces

### Breaking changes

- `AuthUser` and `VobaseUser` types now include optional `activeOrganizationId` field
- Core source files moved: `src/mcp.ts` → `src/mcp/server.ts`, `src/errors.ts` → `src/infra/errors.ts`, etc. (barrel re-exports preserve public API)
