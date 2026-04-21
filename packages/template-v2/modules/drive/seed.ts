/**
 * drive module seed — inserts 7 organization-scoped drive.files rows for the Meridian scenario.
 *
 * /BUSINESS.md contains the Meridian brand profile.
 * Other files contain concise placeholder content.
 */

import { MERIDIAN_ORG_ID } from '@modules/contacts/seed'

export { MERIDIAN_ORG_ID }

const BUSINESS_MD_CONTENT = `# Business Identity

## About
Name: Meridian
Industry: B2C SaaS — productivity tools
Location: 1 Raffles Place, #12-01, Singapore 048616
Website: meridian.app
Support Hours: Mon–Fri 9:00 AM – 6:00 PM SGT

## Brand Voice
Warm, concise, helpful. 2–4 short sentences per reply. Use first name when known.
Avoid jargon. Never promise features we don't have.

## Products
- **Meridian Free** — 1 user, 100 tasks/mo, basic features
- **Meridian Pro** — $12/user/mo, unlimited tasks, integrations, priority support
- **Meridian Teams** — $24/user/mo, SSO, audit log, team workspaces, admin console
- **Meridian Enterprise** — custom pricing, SOC2, dedicated support

## Team (for @mentions)
- @alice — Head of Customer Success (escalations, enterprise)
- @bob — Technical Support Lead (bugs, integrations)
- @carol — Billing Lead (refunds, invoices, plan changes)

## Policies
- Refunds: 14-day money-back on first payment of any plan. After 14 days: prorated credit for unused time.
- Downgrades: effective at next billing cycle. No partial refunds.
- Plan changes: immediate. Prorated.
- Data export: available on all plans. Generated within 24h.
- Account deletion: 30-day grace period, reversible.
- SOC2 docs: available on request (Enterprise only).

## Escalation Rules
- Pricing negotiations → @alice
- Bugs / outages / integrations → @bob
- Refunds / billing disputes → @carol
- Enterprise procurement → @alice
- Security questions / SOC2 → @alice`

interface FileRow {
  id: string
  path: string
  name: string
  content: string
}

const FILES: FileRow[] = [
  {
    id: 'drf0biz000',
    path: '/BUSINESS.md',
    name: 'BUSINESS.md',
    content: BUSINESS_MD_CONTENT,
  },
  {
    id: 'drf0price0',
    path: '/pricing.md',
    name: 'pricing.md',
    content: `# Pricing

| Plan | Price | Users | Tasks |
|---|---|---|---|
| Free | $0 | 1 | 100/mo |
| Pro | $12/user/mo | Unlimited | Unlimited |
| Teams | $24/user/mo | Unlimited | Unlimited + SSO |
| Enterprise | Custom | Unlimited | Unlimited + SOC2 |

All plans include a 14-day free trial. Annual billing saves 20%.`,
  },
  {
    id: 'drf0refund',
    path: '/refunds/policy.md',
    name: 'policy.md',
    content: `# Refund Policy

14-day money-back guarantee on the first payment of any paid plan.

After 14 days: prorated credit for unused time applied to your account.

Downgrades are effective at the next billing cycle — no partial refunds for the current period.

To request a refund, contact support or @carol directly.`,
  },
  {
    id: 'drf0start0',
    path: '/getting-started.md',
    name: 'getting-started.md',
    content: `# Getting Started with Meridian

1. Sign up at meridian.app — free plan available immediately.
2. Create your first project and add tasks.
3. Invite teammates (Pro and above).
4. Connect integrations (Slack, GitHub, Google Calendar) from Settings → Integrations.
5. Need help? Chat with support anytime via the in-app widget.`,
  },
  {
    id: 'drf0slack0',
    path: '/integrations/slack.md',
    name: 'slack.md',
    content: `# Slack Integration

Connect Meridian to your Slack workspace to receive task notifications and updates.

**Setup:**
1. Go to Settings → Integrations → Slack.
2. Click "Connect Slack" and authorise the Meridian app.
3. Choose which channels receive notifications.

**Supported events:** task created, task completed, due-date reminders, @mentions.

Requires Meridian Pro or above.`,
  },
  {
    id: 'drf0soc200',
    path: '/security/soc2-faq.md',
    name: 'soc2-faq.md',
    content: `# SOC 2 FAQ

**Is Meridian SOC 2 certified?**
Yes. Meridian Enterprise includes our SOC 2 Type II report.

**Which trust service criteria are covered?**
Security, Availability, and Confidentiality.

**How do I access the report?**
Enterprise customers can request the report via their account manager or @alice.

**Is Meridian GDPR compliant?**
Yes. Data is processed in Singapore (primary) with EU region available for Enterprise.`,
  },
  {
    id: 'drf0contct',
    path: '/contact.md',
    name: 'contact.md',
    content: `# Team Directory

| Name | Role | Escalation area |
|---|---|---|
| @alice | Head of Customer Success | Pricing negotiations, enterprise procurement, security/SOC2 |
| @bob | Technical Support Lead | Bugs, outages, integration issues |
| @carol | Billing Lead | Refunds, invoices, plan changes |

**Support hours:** Mon–Fri 9:00 AM – 6:00 PM SGT
**Email:** support@meridian.app`,
  },
]

/** Every distinct folder segment in any seeded file path, in root→leaf order so
 *  parents exist before children when we insert them. Deterministic folder ids
 *  keep onConflictDoNothing idempotent across reseeds. */
function foldersFromFiles(
  files: FileRow[],
): Array<{ id: string; path: string; name: string; parentPath: string | null }> {
  const seen = new Map<string, { id: string; path: string; name: string; parentPath: string | null }>()
  for (const f of files) {
    const segs = f.path.split('/').filter(Boolean)
    for (let i = 0; i < segs.length - 1; i++) {
      const path = `/${segs.slice(0, i + 1).join('/')}`
      if (seen.has(path)) continue
      const name = segs[i] as string
      const parentPath = i === 0 ? null : `/${segs.slice(0, i).join('/')}`
      seen.set(path, { id: `drfld${hashId(path)}`, path, name, parentPath })
    }
  }
  return [...seen.values()].sort((a, b) => a.path.length - b.path.length)
}

function hashId(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36).padStart(6, '0').slice(0, 6)
}

export async function seed(db: unknown): Promise<void> {
  const { driveFiles } = await import('@modules/drive/schema')

  const d = db as {
    insert: (t: unknown) => {
      values: (v: unknown) => { onConflictDoNothing: () => Promise<void> }
    }
  }

  const folders = foldersFromFiles(FILES)
  const folderIdByPath = new Map<string, string>(folders.map((f) => [f.path, f.id]))

  for (const folder of folders) {
    const parentId = folder.parentPath ? (folderIdByPath.get(folder.parentPath) ?? null) : null
    await d
      .insert(driveFiles)
      .values({
        id: folder.id,
        organizationId: MERIDIAN_ORG_ID,
        scope: 'organization',
        scopeId: MERIDIAN_ORG_ID,
        kind: 'folder',
        name: folder.name,
        path: folder.path,
        parentFolderId: parentId,
        source: 'admin_uploaded',
        processingStatus: 'ready',
      })
      .onConflictDoNothing()
  }

  for (const file of FILES) {
    const parentPath = parentPathOf(file.path)
    const parentFolderId = parentPath ? (folderIdByPath.get(parentPath) ?? null) : null
    await d
      .insert(driveFiles)
      .values({
        id: file.id,
        organizationId: MERIDIAN_ORG_ID,
        scope: 'organization',
        scopeId: MERIDIAN_ORG_ID,
        kind: 'file',
        name: file.name,
        path: file.path,
        parentFolderId,
        mimeType: 'text/markdown',
        extractedText: file.content,
        source: 'admin_uploaded',
        processingStatus: 'ready',
      })
      .onConflictDoNothing()
  }
}

function parentPathOf(path: string): string | null {
  const idx = path.lastIndexOf('/')
  if (idx <= 0) return null
  return path.slice(0, idx)
}
