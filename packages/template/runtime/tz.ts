/**
 * Org timezone seam — single source of truth for the org-wide timezone used
 * to interpret `date` attribute types (calendar dates without an explicit
 * offset) and to render relative-time UI in the operator's local frame.
 *
 * Loaded from `process.env.TZ` at boot. Bun and Node honor this env var
 * natively for built-in date arithmetic, so a `date` attribute combined with
 * no explicit time is interpreted as midnight in `ORG_TIMEZONE` by default.
 *
 * `datetime` attributes carry their own ISO-8601 offset and are NOT
 * interpreted against this constant — only `date` (calendar) values are.
 *
 * No per-contact timezone in v1 — the org runs in one timezone; cross-region
 * cases use `datetime` to carry their own offset.
 */
export const ORG_TIMEZONE: string = process.env.TZ ?? 'Asia/Singapore'
