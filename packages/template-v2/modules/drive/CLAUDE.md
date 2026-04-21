## modules/drive/

Unified file tree — one `drive.files` table discriminated by `(scope, scope_id)`. Organization-, contact-, and staff-scope live together because the storage shape is identical; the access rules differ.

**Scope rules.**
- `scope='organization'` (brand docs, policies, pricing): agent is read-only — writes go through the proposal flow.
- `scope='contact'` (per-customer uploads, notes): agent is read-write. Inbound media from channels auto-files to `contact:/uploads/`.
- `scope='staff'` (per-staff profile + distilled memory): `/PROFILE.md` is human-authored (read-only to the agent). `/NOTES.md` is rewritten by the memory-distill observer.

**Virtual-field overlay.** Staff `/PROFILE.md` + `/NOTES.md` and contact notes do NOT live as plain rows in `drive.files`. They are **virtual files** projected from backing columns: `team.staff_profiles.profile`/`notes` and `contacts.contacts.notes`. `service/files.ts` carries the overlay — `virtualBackingOf(scope)` + `resolveVirtualField(scope, path)` dispatch reads/writes to the owning service, and `listFolder` offers these entries at the root of the matching scope. Ids use `virtual:<scope>:<id>:<field>`. The sentinel header `<!-- drive:virtual field=X source=Y -->` is added on reads and stripped on writes. This keeps agent-memory edits single-source-of-truth with the domain module that owns the column.

**`BUSINESS.md` is special.** The row at `scope='organization', path='/BUSINESS.md'` is seeded by the platform at organization provisioning and injected into the frozen system prompt at `agent_start`. It's the brand/product/policy persona anchor. Agents cannot overwrite it directly — proposal flow only — because overwriting it would change the frozen prompt mid-wake (violates the frozen-snapshot invariant).

**Proposal flow.** Agent runs `vobase drive propose --path <p> --content <c>` → creates `learning_proposals` row with `scope='drive'` → staff approves in the learnings UI → `FilesService.applyProposal()` writes the file. Rejections become anti-lessons.

**Gemini caption pipeline.** Inbound images/PDFs enqueue a background job calling `CaptionPort.captionImage()` or `extractPdf()`. Results land in `extracted_text`, which is GIN-indexed with `pg_trgm` for fast similarity search. No semantic/vector search in v1 — explicitly deferred. Gated by `CAPTION_PROVIDER=gemini` + `GOOGLE_API_KEY`.

**Frontend.** `DriveProvider` (in `components/drive-provider.tsx`) is the scope root for the browser/tree/preview/editor components; wrap any page that shows drive UI with it. The `drive-browser` tests live under `components/__tests__/`.
