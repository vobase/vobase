/**
 * Meta WhatsApp template wire-shapes — the exact payloads submitted to the
 * Meta Graph `message_templates` endpoint. Single source of truth for both:
 *
 *   - Runtime senders (dispatch a template by name + positional body params)
 *   - The submission script (`scripts/submit-meta-templates.ts`) that creates
 *     these templates against the platform's WABA
 *
 * The platform host appears in two places per template: the BUTTON `url`
 * (`https://<domain>/{{1}}`) and the `example` value Meta requires for
 * approval. Both come from the `domain` parameter so operators on a
 * non-default deployment (e.g. `platform.voltade.app`) can submit identical
 * templates against their own host without forking this file.
 *
 * If you change a template's copy, BUTTONS, or FOOTER, bump the `_vN` suffix
 * and add a new entry rather than mutating an existing one — once a tenant
 * has approval recorded for a name, in-place edits silently change the
 * delivered text. See `NOTIFICATION_TEMPLATES` in `notification-template-payloads.ts`
 * for the list of names the dispatcher knows about; the OTP template here is
 * platform-managed and not part of that tenant-facing list.
 */

export const DEFAULT_PLATFORM_DOMAIN = 'platform.vobase.dev'

const SAMPLE_BUTTON_URL_SUFFIX =
  'auth/magic?tenant=acme&token=sample-token&redirect=%2Finbox%2Fsample&organization=org-sample'

export interface MetaTemplatePayload {
  name: string
  category: 'UTILITY' | 'AUTHENTICATION' | 'MARKETING'
  language: string
  components: unknown[]
}

export function buildMetaTemplateDefinitions(domain: string = DEFAULT_PLATFORM_DOMAIN): MetaTemplatePayload[] {
  const urlBase = `https://${domain}/{{1}}`
  const exampleUrl = `https://${domain}/${SAMPLE_BUTTON_URL_SUFFIX}`

  return [
    {
      name: 'vobase_inbox_mention_v2',
      category: 'UTILITY',
      language: 'en',
      components: [
        {
          type: 'BODY',
          text: 'New mention from _{{1}}_:\n\n*{{2}}*\n\nFrom the conversation inbox.',
          example: { body_text: [['Helpdesk', 'Need help with order #1234']] },
        },
        { type: 'FOOTER', text: 'Reply to instruct the agent.' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL', text: 'Open chat', url: urlBase, example: [exampleUrl] }],
        },
      ],
    },
    {
      name: 'vobase_decision_required_v2',
      category: 'UTILITY',
      language: 'en',
      components: [
        {
          type: 'BODY',
          text: 'Decision needed for *{{1}}*.\n\n_{{2}}_\n\nFiled by _{{3}}_ on your behalf.',
          example: {
            body_text: [['Refund $50', 'Customer requested refund for late delivery', 'Helpdesk']],
          },
        },
        { type: 'FOOTER', text: 'Reply to instruct the agent.' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL', text: 'Review request', url: urlBase, example: [exampleUrl] }],
        },
      ],
    },
    {
      name: 'vobase_admin_alert_v2',
      category: 'UTILITY',
      language: 'en',
      components: [
        {
          type: 'BODY',
          text: 'Admin alert: *{{1}}*\n\n_{{2}}_\n\nTriggered by automation.',
          example: {
            body_text: [['High error rate detected', 'Error rate exceeded 5% in the last 5 minutes']],
          },
        },
        { type: 'FOOTER', text: 'Reply to instruct the agent.' },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'URL', text: 'View details', url: urlBase, example: [exampleUrl] }],
        },
      ],
    },
    // Platform-managed OTP template. Tenants never reference this name at runtime —
    // it lives here only so a single submission pass covers the platform's WABA.
    // OTP has no URL button, so the `domain` parameter has no effect here.
    {
      name: 'vobase_platform_otp',
      category: 'AUTHENTICATION',
      language: 'en',
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 10 },
        {
          type: 'BUTTONS',
          buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }],
        },
      ],
    },
  ]
}

/** Default submission set — uses `DEFAULT_PLATFORM_DOMAIN`. */
export const META_TEMPLATE_DEFINITIONS: readonly MetaTemplatePayload[] = buildMetaTemplateDefinitions()
