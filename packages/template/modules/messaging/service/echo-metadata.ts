/**
 * Echo metadata projection helper.
 * NOT .strict() — provider event.metadata may carry extra keys;
 * this helper extracts only the whitelisted safe subset.
 * Single import point for both inbound dispatch and conversation service.
 */

import { z } from 'zod'

export const MetadataSchema = z.object({
  echo: z.boolean().optional(),
  echoSource: z.enum(['business_app', 'web', 'mac', 'unknown']).optional(),
  direction: z.enum(['outbound', 'inbound']).optional(),
  contactUpdate: z.literal(true).optional(),
  editedAt: z.string().datetime().optional(),
})

export type MessageMetadata = z.infer<typeof MetadataSchema>

export function extractEchoMetadata(raw: Record<string, unknown> | undefined): MessageMetadata {
  if (!raw) return {}
  return MetadataSchema.parse({
    echo: raw.echo,
    echoSource: raw.echoSource,
    direction: raw.direction,
    contactUpdate: raw.contactUpdate,
    editedAt: raw.editedAt,
  })
}
