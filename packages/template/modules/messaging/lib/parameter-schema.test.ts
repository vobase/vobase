import { describe, expect, it } from 'bun:test'

import { ParameterSchema, ParameterSchemaEntry, type ParameterSchemaT } from './parameter-schema'

describe('ParameterSchemaEntry', () => {
  it('accepts all seven type values', () => {
    const types = ['number', 'string', 'boolean', 'select', 'template', 'time', 'audience-filter'] as const

    for (const type of types) {
      const parsed = ParameterSchemaEntry.parse({
        type,
        label: `label for ${type}`,
      })
      expect(parsed.type).toBe(type)
      expect(parsed.label).toBe(`label for ${type}`)
    }
  })

  it('accepts optional default, options, min, max', () => {
    const parsed = ParameterSchemaEntry.parse({
      type: 'number',
      label: 'Count',
      default: 5,
      min: 0,
      max: 100,
    })
    expect(parsed.default).toBe(5)
    expect(parsed.min).toBe(0)
    expect(parsed.max).toBe(100)
  })

  it('accepts options array for select type', () => {
    const parsed = ParameterSchemaEntry.parse({
      type: 'select',
      label: 'Channel',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    })
    expect(parsed.options).toHaveLength(2)
    expect(parsed.options?.[0].value).toBe('a')
  })

  it('rejects unknown type values', () => {
    expect(() => ParameterSchemaEntry.parse({ type: 'bogus', label: 'x' })).toThrow()
  })
})

describe('ParameterSchema', () => {
  it('round-trips a schema containing all seven type values', () => {
    const input: ParameterSchemaT = {
      count: { type: 'number', label: 'Count', default: 1, min: 1, max: 10 },
      subject: { type: 'string', label: 'Subject', default: 'Hello' },
      enabled: { type: 'boolean', label: 'Enabled', default: true },
      channel: {
        type: 'select',
        label: 'Channel',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
      template: {
        type: 'template',
        label: 'Template',
        default: 'welcome_v1',
      },
      sendAt: { type: 'time', label: 'Send at' },
      audience: { type: 'audience-filter', label: 'Audience' },
    }

    const parsed = ParameterSchema.parse(input)
    expect(parsed).toEqual(input)
  })

  it('rejects invalid entries', () => {
    expect(() => ParameterSchema.parse({ bad: { type: 'number' } })).toThrow()
  })
})
