# Tenant Contract Files

These files implement the tenant↔platform wire contract. Changes here usually require a coordinated change on the platform side. See [MIGRATION-COORDINATION.md](./MIGRATION-COORDINATION.md).

| File | Purpose | §-Reference | Version |
|------|---------|-------------|---------|
| `modules/integrations/service/handshake.ts` | Outbound v2 HMAC handshake to platform | §3.12 (platform proxy invariant) | v1 |
| `modules/channels/adapters/whatsapp/managed-transport.ts` | Managed WhatsApp send + inbound verifier | §10 (managed-channels) | v1 |
| `modules/integrations/service/vault.ts` | Encrypted secret storage for tenant integrations | §11 (oauth-proxy) | v1 |
| `modules/integrations/service/verify-token.ts` | JWT verifier for platform-issued integration tokens | §11 | v1 |
