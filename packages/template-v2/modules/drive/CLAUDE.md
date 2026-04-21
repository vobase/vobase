## modules/drive/

Unified file tree — one `drive.files` table discriminated by `(scope, scope_id)`. Organization-scope and contact-scope live together because the storage shape is identical; the access rules differ.

**Scope rules.**
- `scope='organization'` (brand docs, policies, pricing): agent is read-only — writes go through the proposal flow.
- `scope='contact'` (per-customer uploads, notes): agent is read-write. Inbound media from channels auto-files to `contact:/uploads/`.

**`BUSINESS.md` is special.** The row at `scope='organization', path='/BUSINESS.md'` is seeded by the platform at organization provisioning and injected into the frozen system prompt at `agent_start`. It's the brand/product/policy persona anchor. Agents cannot overwrite it directly — proposal flow only — because overwriting it would change the frozen prompt mid-wake (violates the frozen-snapshot invariant).

**Proposal flow.** Agent runs `vobase drive propose --path <p> --content <c>` → creates `learning_proposals` row with `scope='drive'` → staff approves in the learnings UI → `FilesService.applyProposal()` writes the file. Rejections become anti-lessons.

**Gemini caption pipeline.** Inbound images/PDFs enqueue a background job calling `CaptionPort.captionImage()` or `extractPdf()`. Results land in `extracted_text`, which is GIN-indexed with `pg_trgm` for fast similarity search. No semantic/vector search in v1 — explicitly deferred. Gated by `CAPTION_PROVIDER=gemini` + `GOOGLE_API_KEY`.
