import { z } from 'zod'

export const ParameterSchemaEntry = z.object({
  type: z.enum(['number', 'string', 'boolean', 'select', 'template', 'time', 'audience-filter']),
  label: z.string(),
  default: z.unknown().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})

export const ParameterSchema = z.record(z.string(), ParameterSchemaEntry)

export type ParameterSchemaEntryT = z.infer<typeof ParameterSchemaEntry>
export type ParameterSchemaT = z.infer<typeof ParameterSchema>
