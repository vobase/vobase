---
'@vobase/core': minor
'@vobase/template-v2': minor
---

Slice 3c — demote non-domain modules out of `modules/` and unblock a
helpdesk-specific leak in core's read-only enforcer.

**template-v2.** `modules/` now contains exactly the five domain modules:
`messaging`, `agents`, `contacts`, `team`, `drive`. Ops/admin surfaces move to
`server/admin/{settings,system}`; inbound channel transports move to
`server/transports/{web,whatsapp}` (including the `channels` index page and the
former `modules/channels/CLAUDE.md`). All cross-module imports — `vobase.config.ts`,
`server/app.ts`, `server/auth/wire-modules.ts`, `server/wake-handler.ts`,
`src/routes.ts`, `src/routeTree.gen.ts`, `src/lib/api-client.ts`, and
`tests/helpers/simulated-channel-web.ts` — are updated to the new aliases.
`modules/CLAUDE.md` reflects the five-module invariant.

Three transport tests that mocked `@modules/messaging/service/*` and
`@modules/contacts/service/contacts` via `mock.module` now install service stubs
through `installMessagesService`/`installContactsService`/`installConversationsService`
instead. After the filesystem move the files landed in a different test-worker
partition where bun's `mock.module` no longer auto-restored between files;
installing stubs via the existing DI seam keeps the tests hermetic.

**@vobase/core.** `buildReadOnlyConfig` now requires an explicit
`writablePrefixes` list — core no longer ships a helpdesk-specific
`['/workspace/contact/drive/', '/workspace/tmp/']` default. The
`WRITABLE_PREFIXES` re-export is gone, `isWritablePath(path, writablePrefixes)`
takes the list as a required argument, and `new DirtyTracker(snapshot,
writablePrefixes)` follows suit. Template-v2 declares its writable zones in
`server/workspace/index.ts` (`DEFAULT_WRITABLE_PREFIXES`,
`DEFAULT_READ_ONLY_CONFIG`) and threads them through `createWorkspace` and
`DirtyTracker` construction in the harness.
