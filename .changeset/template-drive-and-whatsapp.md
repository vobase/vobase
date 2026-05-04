---
"@vobase/template": minor
---

# Drive (Upload + OCR) and WhatsApp Channel

Two end-to-end template features ship together, both already exercised by the canonical helpdesk scaffold.

## Drive: upload, OCR, and inbound auto-ingest

The `drive` module is now a real agent filesystem. Staff and inbound channels both write through one `ingestUpload(input)` seam; readable artifacts are normalized to `.md` so the agent's bash sandbox can grep them.

- **Storage seam.** `ModuleInitCtx` now carries `storage: StorageAdapter` (local in dev, S3/R2 in prod). Modules consume a single adapter; no per-module file plumbing.
- **Upload pipeline.** `drive:process-file` job extracts text per mime, with a per-page readability gate for PDFs (`MIN_READABLE_CHARS_PER_PAGE = 40`, `MIN_PRINTABLE_RATIO = 0.6`) — pages that fail the gate are routed through OCR rather than trusting watermark glyphs.
- **OCR provider.** `lib/ocr-provider.ts` uses `@ai-sdk/openai` directly via `provider.chat(...)`. Bifrost mode → `google/gemini-2.0-flash`; direct mode → `models.gpt_mini`. Provider + `generateText` memoized so an N-page PDF reuses one handle.
- **Hybrid search.** New `drive_chunks` table backs pgvector + tsvector hybrid search. Post-rank phase batches chunk → file lookups (2 SELECTs total for a 10-hit search; pinned by `files-search.test.ts`).
- **Caption + binary stub.** Every file carries a deterministic 120-char `caption` projection (no LLM on the hot path). Binary files get a stub row plus the agent's new `request_caption` tool, which fires a `caption_ready` wake when extraction completes.
- **Cost ceilings.** Per-org daily budget gate at `modules/drive/service/budget.ts` reads `harness.tenant_cost_daily`. Jobs past the ceiling fail with `processingError = 'org_daily_budget_exceeded'` rather than uncapped spend.
- **Inbound auto-ingest.** WhatsApp inbound media (`MessageReceivedEvent.media[]`) auto-ingests under `/contacts/<id>/<channelInstanceId>/attachments/`. `messages.attachments` jsonb carries refs; `messages.md` materializer renders inline caption blocks per attachment.
- **Loser-of-race reap.** Concurrent webhook redeliveries (Meta retries 5xx up to 7 times) call `filesService.reapAttachmentRows(...)` from `createInboundMessage` on `channelExternalId` unique-violation, so duplicate drive rows never persist.
- **Drive UI.** `<DriveFileList>` gains drag-and-drop upload (folder-scoped overlay, multi-file with toast), per-row 3-dot menu (Rename inline, Delete via AlertDialog, Download original when display ext ≠ original ext), pending-uploads counter, status pill with `processingError` tooltip.
- **Failure paths.** Post-storage UPDATE failure deletes the just-uploaded storage object and marks the row `(failed, failed)` with a structured `processingError`. `markFailed` and embedding-fail catch in `jobs.ts` log via `@vobase/core` logger so operators can grep stderr.
- **Wake bus rename.** `INBOUND_TO_WAKE_JOB → AGENTS_WAKE_JOB`; pg-boss queue renamed to `'agents:wake'`. `WakeTriggerSchema` is `z.discriminatedUnion('trigger', [...])` with paired-shape compile-time drift guard.

## WhatsApp channel

End-to-end Cloud API support across self-managed and platform-managed modes — see [`@vobase/core@0.36.0`](https://github.com/vobase/vobase/releases) for the underlying transport seam, envelope-encrypted vault, and 2-key HMAC sig v2 contract.

Template-side surfaces:

- **Embedded Signup.** `<WhatsAppSignupButton variant="hero" | "compact">` Facebook SDK launcher, server-side code exchange (`/signup/start` + `/signup/exchange`), nonce table bound to `(orgId, sessionId)` with 5-min expiry, mandatory `debug_token` validation, per-org rate limit (10/h), per-IP failure bucket (60/min).
- **Coexistence.** `smb_message_echoes` parsed and persisted as `role='staff', metadata.echoSource`. Echoes do NOT enqueue wake jobs, do NOT open the 24-hour service window, do NOT fan out `add_note`.
- **Platform-managed sandbox.** Tenant config carries only `{ mode: 'managed', platformChannelId, platformBaseUrl }` — zero Meta credentials at rest. TOCTOU-safe `upsertManagedInstance` via Postgres generated column + partial unique index.
- **24-hour service window.** `messaging.conversation_sessions` tracks open sessions per `(conversationId, channelInstanceId)`. Outbound dispatcher precheck returns `SendResult { code: 'window_expired' }` instead of attempting a doomed send.
- **Status FSM + reactions.** `messages.updateDeliveryStatus()` enforces `queued → sent → delivered → read` (no backward); `failed` terminal; never mutates `role`/`content`. Reactions write through new `messaging/service/reactions.ts` only — `check:shape` enforced.
- **Doctor.** `vobase channels:doctor :instanceId` runs `debug_token`, `subscribed_apps`, `phone_numbers`, `message_templates`, surfaces results in `<InstanceDoctorSheet>` with red/amber/green pills.
- **Channels admin UI.** Single unified `<ChannelsTable>` (DiceUI data-table) replaces the prior tile catalog. WhatsApp + Web channels coexist with a `<ModeChip>` per row. Row-action menu opens slide-over sheets for Doctor (WA), Templates (WA), Embed snippets (Web).
- **CLI verbs.** `vobase channels:list`, `vobase channels:instance:show :id`, `vobase channels:doctor :id`, `vobase channels:templates:sync :id`.
- **TRUST_PROXY_HOPS.** New env var defaults to `0` (ignore XFF) for prod safety. Operators behind a sanitizing proxy must set it explicitly.
- **Admin role gating.** `getRequireAdmin()` lazy accessor enforces `owner | admin` on every signup/managed/doctor mutation route.

## Frontend bundle isolation

`check:bundle` extended to forbid `~/runtime` imports from `src/**` so backend code (auth handles, db client, jobs) cannot leak into the browser bundle.

## Test coverage

- 23 new test files spanning e2e (caption-ready wake, attachment auto-ingest, attachment failure/orphan, inbound redelivery, loser-of-race reap, full ESU flow), integration (managed transport, echoes, doctor, signup nonces), unit (sessions FSM, reactions, dispatch routing, request-IP `TRUST_PROXY_HOPS`), and live smokes (`bun run smoke:wa` covering inbound, outbound echo, doctor, templates).
- 616 passing / 5 skipped / 1 todo at the end of the slice; 6 pre-existing failures (contacts service not installed in test env) unchanged.

## Operational notes

- **Backfill:** ops needs to populate `tenant_environments` rows for existing managed tenants so the per-env webhook resolver targets the right `instanceUrl`. Falls back gracefully today.
- **Open follow-ups (non-blocking):** `Reassign default…` row action wired but disabled (needs AssigneeSelect popover); `mergeContacts(...)` is a JSDoc-only skeleton; vault `previous` decryption is eager per read (bounded by 60s rotation cache TTL — optional lazy follow-up); WA-inbound live smoke deferred until `META_WA_*` configured in dev.
