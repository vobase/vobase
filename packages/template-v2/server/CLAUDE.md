## server/

Why this folder exists: Vite scans only `src/`. Putting runtime code (pg, pg-boss, postgres, pi-agent-core, just-bash) under `src/` forces the browser bundler to resolve native drivers and breaks the build. `server/` is the hard Vite-exclusion line; nothing in here is ever imported from `src/` (enforced by `check:bundle`).

Path alias: `@server/*` → `server/*`. Cross-module access goes directly to the other module's service: `import { appendTextMessage } from '@modules/messaging/service/messages'`. The `messages` / `conversation_events` tables have a CI-enforced one-write-path guard (`checkJournalWriteAuthority`); other tables are open.
