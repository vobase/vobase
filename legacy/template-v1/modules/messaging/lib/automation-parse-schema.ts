import { z } from 'zod'

import { audienceFilterSchema } from './audience-filter'
import { ParameterSchema } from './parameter-schema'

export const DraftRuleStepSchema = z.object({
  sequence: z.number().int().min(1),
  offsetDays: z.number().int().optional(),
  sendAtTime: z
    .string()
    .regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .optional(),
  delayHours: z.number().int().optional(),
  templateSuggestion: z.string().min(1),
  variableMapping: z.record(z.string(), z.string()).optional(),
  isFinal: z.boolean().optional(),
})

export const DraftRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['recurring', 'date-relative']),
  schedule: z.string().optional(),
  dateAttribute: z.string().optional(),
  timezone: z.string().optional(),
  audienceFilter: audienceFilterSchema.optional(),
  suggestedSegments: z.array(z.string()).optional(),
  steps: z.array(DraftRuleStepSchema).min(1),
  parameters: z.record(z.string(), z.unknown()).optional(),
  parameterSchema: ParameterSchema.optional(),
})

export type DraftRuleStep = z.infer<typeof DraftRuleStepSchema>
export type DraftRule = z.infer<typeof DraftRuleSchema>
