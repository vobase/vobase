---
"@vobase/template": patch
---

fix(runtime/bootstrap): map better-auth `owner` role to `admin` audience tier

`getAudience` only checked `p.role === 'admin'`, so org owners (who outrank admin in better-auth's `owner > admin > member` hierarchy) were demoted to the `staff` audience tier and couldn't see admin-tier CLI verbs in the catalog. Both `owner` and `admin` now map to `'admin'`.
