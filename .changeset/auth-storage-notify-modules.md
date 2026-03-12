---
"@vobase/core": minor
---

Extract auth, storage, and notify into built-in modules with config-driven boot. Auth uses an `AuthAdapter` interface, storage provides a virtual bucket model (`StorageService` + `BucketHandle`) with local and S3 providers, and notify offers channel-based delivery (email via Resend/SMTP, WhatsApp via WABA) with automatic logging. Template syncs `db-schemas.ts` with new core tables and fixes pagination, login UI, and dark mode sidebar color.
