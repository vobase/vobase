import { describe, expect, it } from 'bun:test'
import { VobaseError } from '@vobase/core'

import {
  AdminAlertBody,
  BODY_SCHEMAS,
  bodyParamsForWire,
  DecisionRequiredBody,
  InboxMentionBody,
  NOTIFICATION_TEMPLATES,
  redirectPathFor,
  renderTemplateAsText,
  templateNameFor,
} from './notification-template-payloads'

describe('BODY_SCHEMAS exhaustiveness', () => {
  it('covers exactly the same keys as NOTIFICATION_TEMPLATES', () => {
    expect(Object.keys(BODY_SCHEMAS).sort()).toEqual([...NOTIFICATION_TEMPLATES].sort())
  })
})

describe('redirectPathFor', () => {
  it('mention → /inbox/<contactId>', () => {
    expect(redirectPathFor({ kind: 'mention', contactId: 'ct1' })).toBe('/inbox/ct1')
  })

  it('approval → /inbox/<contactId>', () => {
    expect(redirectPathFor({ kind: 'approval', contactId: 'ct1' })).toBe('/inbox/ct1')
  })

  it('proposal → /inbox/<contactId>', () => {
    expect(redirectPathFor({ kind: 'proposal', contactId: 'ct1' })).toBe('/inbox/ct1')
  })

  it('falls back to /inbox when contactId is empty', () => {
    expect(redirectPathFor({ kind: 'mention', contactId: '' })).toBe('/inbox')
  })

  it('admin_alert → /automations', () => {
    expect(redirectPathFor({ kind: 'admin_alert' })).toBe('/automations')
  })
})

describe('templateNameFor', () => {
  it('mention → vobase_inbox_mention_v2', () => {
    expect(templateNameFor('mention')).toBe('vobase_inbox_mention_v2')
  })

  it('approval → vobase_decision_required_v2', () => {
    expect(templateNameFor('approval')).toBe('vobase_decision_required_v2')
  })

  it('proposal → vobase_decision_required_v2', () => {
    expect(templateNameFor('proposal')).toBe('vobase_decision_required_v2')
  })

  it('admin_alert → vobase_admin_alert_v2', () => {
    expect(templateNameFor('admin_alert')).toBe('vobase_admin_alert_v2')
  })
})

describe('bodyParamsForWire', () => {
  it('vobase_inbox_mention_v2 → [agentName, snippet]', () => {
    expect(
      bodyParamsForWire('vobase_inbox_mention_v2', {
        agentName: 'Helpdesk',
        snippet: 'hi',
      }),
    ).toEqual(['Helpdesk', 'hi'])
  })

  it('vobase_decision_required_v2 → [summary, detail, agentName]', () => {
    expect(bodyParamsForWire('vobase_decision_required_v2', { agentName: 'A', summary: 'B', detail: 'C' })).toEqual([
      'B',
      'C',
      'A',
    ])
  })

  it('vobase_admin_alert_v2 → [alertHeadline, alertDetail]', () => {
    expect(bodyParamsForWire('vobase_admin_alert_v2', { alertHeadline: 'H', alertDetail: 'D' })).toEqual(['H', 'D'])
  })
})

describe('body schema validation', () => {
  it('InboxMentionBody rejects agentName longer than 80 chars', () => {
    expect(InboxMentionBody.safeParse({ agentName: 'x'.repeat(81), snippet: 'hi' }).success).toBe(false)
  })

  it('InboxMentionBody rejects empty agentName', () => {
    expect(InboxMentionBody.safeParse({ agentName: '', snippet: 'hi' }).success).toBe(false)
  })

  it('InboxMentionBody rejects snippet longer than 200 chars', () => {
    expect(InboxMentionBody.safeParse({ agentName: 'A', snippet: 'x'.repeat(201) }).success).toBe(false)
  })

  it('DecisionRequiredBody rejects missing fields', () => {
    expect(DecisionRequiredBody.safeParse({ agentName: 'A' }).success).toBe(false)
  })

  it('DecisionRequiredBody rejects summary longer than 80 chars', () => {
    expect(DecisionRequiredBody.safeParse({ agentName: 'A', summary: 'x'.repeat(81), detail: 'C' }).success).toBe(false)
  })

  it('DecisionRequiredBody rejects detail longer than 200 chars', () => {
    expect(DecisionRequiredBody.safeParse({ agentName: 'A', summary: 'S', detail: 'x'.repeat(201) }).success).toBe(
      false,
    )
  })

  it('DecisionRequiredBody rejects empty strings', () => {
    expect(DecisionRequiredBody.safeParse({ agentName: '', summary: 's', detail: 'd' }).success).toBe(false)
  })

  it('AdminAlertBody rejects alertHeadline longer than 120 chars', () => {
    expect(AdminAlertBody.safeParse({ alertHeadline: 'x'.repeat(121), alertDetail: 'D' }).success).toBe(false)
  })

  it('AdminAlertBody rejects empty alertDetail', () => {
    expect(AdminAlertBody.safeParse({ alertHeadline: 'H', alertDetail: '' }).success).toBe(false)
  })
})

describe('renderTemplateAsText', () => {
  it('vobase_inbox_mention_v2 snapshot', () => {
    const result = renderTemplateAsText(
      'vobase_inbox_mention_v2',
      { agentName: 'Helpdesk', snippet: 'Need help with order' },
      'https://platform.vobase.dev/auth/magic?token=abc',
    )
    expect(result).toBe(
      'New mention from _Helpdesk_:\n\n*Need help with order*\n\nFrom the conversation inbox.\n\nReply to instruct the agent.\n\nOpen: https://platform.vobase.dev/auth/magic?token=abc',
    )
  })

  it('vobase_decision_required_v2 snapshot', () => {
    const result = renderTemplateAsText(
      'vobase_decision_required_v2',
      {
        agentName: 'Helpdesk',
        summary: 'Refund $50',
        detail: 'Customer requested refund for late delivery',
      },
      'https://platform.vobase.dev/auth/magic?token=abc',
    )
    expect(result).toBe(
      'Decision needed for *Refund $50*.\n\n_Customer requested refund for late delivery_\n\nFiled by _Helpdesk_ on your behalf.\n\nReply to instruct the agent.\n\nOpen: https://platform.vobase.dev/auth/magic?token=abc',
    )
  })

  it('vobase_admin_alert_v2 snapshot', () => {
    const result = renderTemplateAsText(
      'vobase_admin_alert_v2',
      {
        alertHeadline: 'High error rate detected',
        alertDetail: 'Error rate exceeded 5% in the last 5 minutes',
      },
      'https://platform.vobase.dev/auth/magic?token=abc',
    )
    expect(result).toBe(
      'Admin alert: *High error rate detected*\n\n_Error rate exceeded 5% in the last 5 minutes_\n\nTriggered by automation.\n\nReply to instruct the agent.\n\nOpen: https://platform.vobase.dev/auth/magic?token=abc',
    )
  })

  it('throws VobaseError.validation on invalid bodyParams', () => {
    expect(() =>
      renderTemplateAsText('vobase_inbox_mention_v2', { agentName: '', snippet: 'x' }, 'https://example.com'),
    ).toThrow(VobaseError)

    let caught: unknown
    try {
      renderTemplateAsText('vobase_decision_required_v2', { agentName: 'A' }, 'https://example.com')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(VobaseError)
    expect((caught as VobaseError).code).toBe('VALIDATION')
  })
})
