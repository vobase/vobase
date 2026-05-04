---
"@vobase/template": patch
---

# Fix theme FOUC bootstrap and echoes test setup

Two unrelated, mechanical fixes from running the unmodified scaffold:

**`index.html` theme bootstrap reads stale storage key.** The pre-paint FOUC-prevention script in `index.html` reads `localStorage.getItem("template-v2-theme")`, but `theme-provider.tsx` (and its test) write/read `vobase-theme`. This causes the bootstrap script to never find a saved preference and always default to `system`, producing a real flash on hydration for users who'd selected `light` or `dark`. Aligns the bootstrap with the actual storage key.

**`modules/channels/adapters/whatsapp/echoes.test.ts` missing contacts service install.** The test's `beforeAll` installs `conversations`, `messages`, `sessions`, `reactions`, and `channels` services but never installs `contacts`. Because `dispatchInbound` → `contacts.upsertByExternal` reads the contacts singleton, every test in the file throws `contacts/contacts: service not installed`. Adds the install matching the canonical pattern in `tests/helpers/attachments-fixture.ts`.

After these fixes: 1 previously failing test goes green (theme FOUC), and the `smb_message_echoes` tests pass cleanly when the file is run in isolation. (The echoes tests still fail in the full-suite run due to a separate cross-test DB-state pollution issue — filing a separate report.)
