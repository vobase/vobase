import { describe, expect, it } from 'bun:test'

import {
  AdminAlertBody,
  ApprovalDecisionBody,
  BODY_SCHEMAS,
  bodyParamsForWire,
  NOTIFICATION_TEMPLATES,
  ProposalDecisionBody,
  redirectPathFor,
  TenantNotificationBody,
  templateNameFor,
} from './notification-template-payloads'

describe('BODY_SCHEMAS exhaustiveness', () => {
  it('covers exactly the same keys as NOTIFICATION_TEMPLATES', () => {
    expect(Object.keys(BODY_SCHEMAS).sort()).toEqual([...NOTIFICATION_TEMPLATES].sort())
  })
})

describe('redirectPathFor', () => {
  it('mention → /inbox/<conversationId>', () => {
    expect(redirectPathFor({ kind: 'mention', conversationId: 'c1' })).toBe('/inbox/c1')
  })

  it('approval → /inbox/<conversationId>/approvals/<approvalId>', () => {
    expect(redirectPathFor({ kind: 'approval', conversationId: 'c1', approvalId: 'a1' })).toBe('/inbox/c1/approvals/a1')
  })

  it('proposal → /inbox/<conversationId>/proposals/<proposalId>', () => {
    expect(redirectPathFor({ kind: 'proposal', conversationId: 'c1', proposalId: 'p1' })).toBe('/inbox/c1/proposals/p1')
  })

  it('admin_alert → /system/activity', () => {
    expect(redirectPathFor({ kind: 'admin_alert' })).toBe('/system/activity')
  })
})

describe('templateNameFor', () => {
  it('mention → vobase_tenant_notification', () => {
    expect(templateNameFor('mention')).toBe('vobase_tenant_notification')
  })

  it('approval → vobase_approval_decision', () => {
    expect(templateNameFor('approval')).toBe('vobase_approval_decision')
  })

  it('proposal → vobase_proposal_decision', () => {
    expect(templateNameFor('proposal')).toBe('vobase_proposal_decision')
  })

  it('admin_alert → vobase_admin_alert', () => {
    expect(templateNameFor('admin_alert')).toBe('vobase_admin_alert')
  })
})

describe('bodyParamsForWire', () => {
  it('vobase_tenant_notification → [mentionerName, snippet, agentName]', () => {
    expect(
      bodyParamsForWire('vobase_tenant_notification', { mentionerName: 'Bob', snippet: 'hi', agentName: 'Helpdesk' }),
    ).toEqual(['Bob', 'hi', 'Helpdesk'])
  })

  it('vobase_approval_decision → [agentName, approvalSummary, approvalContext]', () => {
    expect(
      bodyParamsForWire('vobase_approval_decision', { agentName: 'A', approvalSummary: 'B', approvalContext: 'C' }),
    ).toEqual(['A', 'B', 'C'])
  })

  it('vobase_proposal_decision → [agentName, resourceLabel, proposalSummary]', () => {
    expect(
      bodyParamsForWire('vobase_proposal_decision', {
        agentName: 'A',
        resourceLabel: 'contacts/profile-field',
        proposalSummary: 'C',
      }),
    ).toEqual(['A', 'contacts/profile-field', 'C'])
  })

  it('vobase_admin_alert → [alertHeadline, alertDetail, organizationName]', () => {
    expect(
      bodyParamsForWire('vobase_admin_alert', { alertHeadline: 'H', alertDetail: 'D', organizationName: 'O' }),
    ).toEqual(['H', 'D', 'O'])
  })
})

describe('body schema validation', () => {
  it('TenantNotificationBody rejects mentionerName longer than 80 chars', () => {
    expect(
      TenantNotificationBody.safeParse({ mentionerName: 'x'.repeat(81), snippet: 'hi', agentName: 'A' }).success,
    ).toBe(false)
  })

  it('TenantNotificationBody rejects empty mentionerName', () => {
    expect(TenantNotificationBody.safeParse({ mentionerName: '', snippet: 'hi', agentName: 'A' }).success).toBe(false)
  })

  it('TenantNotificationBody rejects snippet longer than 200 chars', () => {
    expect(
      TenantNotificationBody.safeParse({ mentionerName: 'Bob', snippet: 'x'.repeat(201), agentName: 'A' }).success,
    ).toBe(false)
  })

  it('ApprovalDecisionBody rejects missing fields', () => {
    expect(ApprovalDecisionBody.safeParse({ agentName: 'A' }).success).toBe(false)
  })

  it('ApprovalDecisionBody rejects approvalSummary longer than 80 chars', () => {
    expect(
      ApprovalDecisionBody.safeParse({ agentName: 'A', approvalSummary: 'x'.repeat(81), approvalContext: 'C' }).success,
    ).toBe(false)
  })

  it('ProposalDecisionBody rejects resourceLabel longer than 60 chars', () => {
    expect(
      ProposalDecisionBody.safeParse({ agentName: 'A', resourceLabel: 'x'.repeat(61), proposalSummary: 'S' }).success,
    ).toBe(false)
  })

  it('ProposalDecisionBody rejects empty strings', () => {
    expect(ProposalDecisionBody.safeParse({ agentName: '', resourceLabel: 'r', proposalSummary: 's' }).success).toBe(
      false,
    )
  })

  it('AdminAlertBody rejects alertHeadline longer than 120 chars', () => {
    expect(
      AdminAlertBody.safeParse({ alertHeadline: 'x'.repeat(121), alertDetail: 'D', organizationName: 'O' }).success,
    ).toBe(false)
  })

  it('AdminAlertBody rejects empty alertDetail', () => {
    expect(AdminAlertBody.safeParse({ alertHeadline: 'H', alertDetail: '', organizationName: 'O' }).success).toBe(false)
  })
})
