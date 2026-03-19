---
"@vobase/core": minor
---

Fix platform OAuth integration flow (3 bugs found during e2e testing):

- Mount platform auth routes before better-auth catch-all so `/api/auth/platform-callback` is reachable
- Use `signUpEmail()` instead of `createUser()` (which requires the admin plugin) when creating platform users
- Sign session cookie with HMAC-SHA256 to match better-auth's signed cookie format, and use explicit `Response` for redirect to preserve `Set-Cookie` header

Also replace `packages/template/CLAUDE.md` symlink with a real file to prevent broken symlinks when GitHub creates repos from the template.
