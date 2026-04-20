## server/middlewares/

Hono middlewares that cut across modules. Not framework runtime (don't import from here in `@modules/**/schema.ts` or `service/`) — these operate on the HTTP layer only.

Middlewares that need auth/db are factories so tests can inject a mock instance instead of reading from a module-level singleton.

**HMAC webhook.** `verifyHmacWebhook(c, opts)` is a helper (not middleware) so handlers stay testable with a mock context. Current callers need custom control flow after the signature check — whatsapp 200-acks unknown payloads, channel-web parses with a Zod schema — so a Hono-only `MiddlewareHandler` wrapper wouldn't fit.

**`devBypass` is dev-only.** When `NODE_ENV !== 'production'` AND no secret is configured AND no signature header is present, `verifyHmacWebhook` logs a warning and proceeds. Meant for webhook-provider validation dances (Meta's initial GET challenge before a secret is wired up). Never set `devBypass: true` on a route that handles real user data without a secret in prod.

**Signature header format.** `parseHubSignature(c)` strips the `sha256=` prefix if present. Both Meta and our channel-web webhook use `X-Hub-Signature-256`; channel-web's client signs raw hex, Meta signs with the `sha256=` prefix. Same parser handles both.
