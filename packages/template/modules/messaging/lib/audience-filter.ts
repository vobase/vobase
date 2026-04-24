import type { VobaseDb } from '@vobase/core'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { contactLabels, contacts } from '../schema'

export const attributeOperatorSchema = z.enum(['eq', '!=', '>=', '<=', 'contains'])
export type AttributeOperator = z.infer<typeof attributeOperatorSchema>

export const audienceFilterSchema = z.object({
  roles: z.array(z.enum(['customer', 'lead', 'staff'])).optional(),
  labelIds: z.array(z.string()).optional(),
  attributes: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
        op: attributeOperatorSchema.optional(),
      }),
    )
    .optional(),
  excludeOptedOut: z.boolean().default(true),
})

export type AudienceFilter = z.infer<typeof audienceFilterSchema>

/** Build WHERE conditions from audience filter criteria */
export function buildAudienceConditions(filter: AudienceFilter) {
  const conditions = []

  if (filter.roles && filter.roles.length > 0) {
    conditions.push(
      filter.roles.length === 1 ? eq(contacts.role, filter.roles[0]) : inArray(contacts.role, filter.roles),
    )
  }

  // Must have a phone number for WhatsApp broadcasts
  conditions.push(sql`${contacts.phone} IS NOT NULL`)

  if (filter.excludeOptedOut) {
    conditions.push(eq(contacts.marketingOptOut, false))
  }

  // Attribute filters via JSONB — use jsonb_extract_path_text to safely parameterize key
  if (filter.attributes && filter.attributes.length > 0) {
    for (const attr of filter.attributes) {
      const op: AttributeOperator = attr.op ?? 'eq'
      const extracted = sql`jsonb_extract_path_text(${contacts.attributes}, ${attr.key})`
      switch (op) {
        case 'eq':
          conditions.push(sql`${extracted} = ${attr.value}`)
          break
        case '!=':
          conditions.push(sql`${extracted} <> ${attr.value}`)
          break
        case '>=':
          conditions.push(sql`${extracted} >= ${attr.value}`)
          break
        case '<=':
          conditions.push(sql`${extracted} <= ${attr.value}`)
          break
        case 'contains':
          // Case-insensitive substring match via strpos — avoids LIKE-escape concerns.
          conditions.push(sql`strpos(lower(${extracted}), lower(${attr.value})) > 0`)
          break
      }
    }
  }

  return conditions.length > 0 ? and(...conditions) : undefined
}

/** Build full contacts WHERE including the contactLabels sub-select for labelIds. */
export function buildAudienceWhereWithLabels(db: VobaseDb, filter: AudienceFilter) {
  const where = buildAudienceConditions(filter)
  let labelCondition: ReturnType<typeof inArray> | undefined
  if (filter.labelIds && filter.labelIds.length > 0) {
    const sub = db
      .selectDistinct({ contactId: contactLabels.contactId })
      .from(contactLabels)
      .where(inArray(contactLabels.labelId, filter.labelIds))
    labelCondition = inArray(contacts.id, sub)
  }
  if (where && labelCondition) return and(where, labelCondition)
  return labelCondition ?? where
}
