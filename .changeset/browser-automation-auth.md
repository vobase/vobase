---
"@vobase/core": minor
---

Add createApiKey/revokeApiKey to auth contract and ModuleInitContext

- New `CreateApiKey` and `RevokeApiKey` types in auth contract for programmatic API key management
- `revokeApiKey(keyId)` disables an API key by ID (used by automation module on session disconnect)
- `createApiKey` accepts `expiresIn` for time-bounded keys
- Organization tables now always included in schema (no longer conditional)
- Removed `organizationEnabled` from MCP CRUD context and permission guards
- API key schema updated: `referenceId`/`configId` columns replace `userId`, proper rate limit defaults
- Added `activeOrganizationId` to session table
