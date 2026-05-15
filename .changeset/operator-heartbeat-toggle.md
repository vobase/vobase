---
'@vobase/template': patch
---

Three independent template changes, batched:

**Operator-agent heartbeat kill-switch.** A new org-scoped setting,
`operatorHeartbeatEnabled`, gates the cron-driven standalone-lane wakes
(`renderStandaloneBrief`). The Settings → Operator agent section now exposes
a toggle backed by `useOrgSetting`, a new generic hook over the
`/api/settings/org-settings/:key` surface that replaces the two ~20-line
useQuery+useMutation pairs the page previously inlined. The kill-switch is
read once per cron tick (`tickSchedules` accepts a `disabledOrgIds` dep and
filters disabled orgs *before* `recordTick`), so a 1000-org sweep does one
batched read instead of one round-trip per schedule and disabled orgs no
longer burn idempotency-row writes either. `OrgSettingsService` gains a
`listOrgsWithValue(key, value)` method to support that batch read.

**`send_file` accepts a public URL, not just a drive file.** The tool's
input is now `{ driveFileId XOR url, type?, caption? }`, both at the agent
boundary and at the `appendMediaMessage` service layer. URL-mode skips the
drive lookup and threat scan, infers `image|video|audio|document` from the
URL extension (with an explicit override), and persists a `{url, type,
caption}` content blob the conversation renderer picks up as either an
inline `<img>` or an anchor. `send_file` is also removed from
`CUSTOMER_FACING_TOOL_NAMES` on staff_note wakes — a staff @-mention naming
a specific artefact is a directive, and the tool still goes through
`requiresApproval: true`. `reply_contact` and `send_card` stay banned
because their content is agent-authored. Adjacent prompt cleanup in
`messaging/agent.ts` clarifies the staff-note recipe (when `send_file` works,
when `add_note` is the right answer) and in `reply-contact.ts` clarifies
that pasted URLs render as bare links — use `send_file({url})` for inline
media.

**API-key rate limit defaults.** The better-auth plugin's stock
`apiKey()` defaults were 10 requests / 24h per key, which the operator CLI
trips immediately on catalog + verb fan-out and surfaces as a
`RATE_LIMITED` → 500 that reads like a revoked key. The plugin is now
configured with a 600 req/min cap and the `apikey` table defaults align
(60_000 / 600) so freshly-issued keys inherit the new policy without a
backfill. Tighten this once a real per-key policy lands.
