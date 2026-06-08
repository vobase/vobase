---
"@vobase/template": patch
---

# Drive embeddings via Bifrost, no embed-token cap, and a race-safe contact upsert

Three production-hardening fixes for the drive knowledge base and contact sync.

## Drive embeddings route through the Bifrost gateway

The drive embedding helper read `OPENAI_API_KEY` and called OpenAI directly, unlike `wake/llm.ts` which routes through Bifrost when `BIFROST_API_KEY` + `BIFROST_URL` are set. In a Bifrost-only production (no `OPENAI_API_KEY`) every extraction job failed with `embedding_unavailable: OPENAI_API_KEY is not set`, so `drive.chunks` stayed empty and hybrid `drive search` returned nothing. Embeddings now go through `createOpenAI({ baseURL, apiKey })` pointed at the gateway with the `openai/`-prefixed model id when the Bifrost vars are present, falling back to the direct OpenAI endpoint for local dev. The same provider gate is applied to query-time embedding, so semantic search works in production too — not just ingestion.

## The per-org daily embed-token cap is no longer enforced

A per-day embed-token gate stalled a legitimate one-shot knowledge-base backfill, which embeds an org's whole document set in a single burst. Embedding is comparatively cheap, so the cap cost more in blocked backfills than it saved. The gate is removed from `checkBudget` (the OCR page cap — the expensive lever — is retained), and `embedTokens` usage is still rolled up by `getTodayUsage` for observability.

## Contact upsert is idempotent under concurrent same-identity inserts

Two upserts for the same person (e.g. a retried/redelivered WhatsApp `smb_app_state_sync` burst running while the first delivery is still in flight) both saw an empty `contacts` table, both INSERTed, and the loser threw a `uq_contacts_tenant_phone` duplicate-key error. The identity insert now uses `onConflictDoNothing` and re-resolves the winner when it loses the race, so every concurrent caller returns the same contact id and none throw.
