/**
 * `vobase memory {show,append,clear}` verb registrations.
 *
 * Memory has three scopes:
 *  - `agent`   ↔ `agent_definitions.working_memory` (one row per agent)
 *  - `contact` ↔ `contacts.memory`                  (one row per contact)
 *  - `staff`   ↔ `agent_staff_memory.memory`        (per-(agent, staff) blob)
 *
 * `agent` + `contact` flow through the drive `filesService.readPath/writePath`
 * primitive (which strips the virtual sentinel header on write); `staff` goes
 * straight to `staff-memory` because it isn't surfaced under `/drive/**`.
 *
 * The verbs are part of the agents module so all three live next to the staff
 * memory service that one of them writes to. Cross-module contact reads stay
 * through the drive service to keep the virtual-file rules in one place.
 */

import * as contactsSvc from '@modules/contacts/service/contacts'
import { filesServiceFor } from '@modules/drive/service/files'
import type { DriveScope } from '@modules/drive/service/types'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { readStaffMemory, upsertStaffMemory } from './service/staff-memory'

const ScopeSchema = z
  .object({
    scope: z.enum(['agent', 'contact', 'staff']),
    id: z.string().optional(),
    agentId: z.string().optional(),
    staffId: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.scope === 'staff') {
      if (!val.agentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '--agentId is required for staff memory',
          path: ['agentId'],
        })
      }
      if (!val.staffId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: '--staffId is required for staff memory',
          path: ['staffId'],
        })
      }
    } else if (!val.id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `--id is required for scope=${val.scope}`, path: ['id'] })
    }
  })

type ScopeInput = z.infer<typeof ScopeSchema>

function driveScopeOf(input: ScopeInput): DriveScope {
  if (input.scope === 'agent') return { scope: 'agent', agentId: input.id as string }
  return { scope: 'contact', contactId: input.id as string }
}

async function readMemory(input: ScopeInput, organizationId: string): Promise<string> {
  if (input.scope === 'staff') {
    return readStaffMemory({
      organizationId,
      agentId: input.agentId as string,
      staffId: input.staffId as string,
    })
  }
  if (input.scope === 'contact') {
    const contact = await contactsSvc.get(input.id as string)
    if (contact.organizationId !== organizationId) throw new Error('contact not in this organization')
    return contactsSvc.readMemory(input.id as string)
  }
  const svc = filesServiceFor(organizationId)
  const result = await svc.readPath(driveScopeOf(input), '/MEMORY.md')
  return result?.content ?? ''
}

async function writeMemory(input: ScopeInput, organizationId: string, content: string): Promise<void> {
  if (input.scope === 'staff') {
    await upsertStaffMemory(
      { organizationId, agentId: input.agentId as string, staffId: input.staffId as string },
      content,
    )
    return
  }
  if (input.scope === 'contact') {
    const contact = await contactsSvc.get(input.id as string)
    if (contact.organizationId !== organizationId) throw new Error('contact not in this organization')
    const svc = filesServiceFor(organizationId)
    await svc.writePath({ scope: 'contact', contactId: input.id as string }, '/MEMORY.md', content)
    return
  }
  const svc = filesServiceFor(organizationId)
  await svc.writePath(driveScopeOf(input), '/MEMORY.md', content)
}

export const memoryShowVerb = defineCliVerb({
  name: 'memory show',
  description: 'Show the memory blob for an agent, contact, or (agent, staff) pair.',
  input: z.object({
    scope: z.enum(['agent', 'contact', 'staff']),
    id: z.string().optional(),
    agentId: z.string().optional(),
    staffId: z.string().optional(),
  }),
  body: async ({ input, ctx }) => {
    const parsed = ScopeSchema.parse(input)
    try {
      const content = await readMemory(parsed, ctx.organizationId)
      return { ok: true as const, data: { scope: parsed.scope, bytes: content.length, content } }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'read_failed',
      }
    }
  },
  formatHint: 'lines:field=content',
})

export const memoryAppendVerb = defineCliVerb({
  name: 'memory append',
  description: 'Append a paragraph to the memory blob (newline-separated).',
  input: z.object({
    scope: z.enum(['agent', 'contact', 'staff']),
    id: z.string().optional(),
    agentId: z.string().optional(),
    staffId: z.string().optional(),
    content: z.string().min(1),
  }),
  body: async ({ input, ctx }) => {
    const parsed = ScopeSchema.parse(input)
    try {
      const existing = await readMemory(parsed, ctx.organizationId)
      const next = existing
        ? `${existing.replace(/\s+$/, '')}\n\n${input.content.trim()}\n`
        : `${input.content.trim()}\n`
      await writeMemory(parsed, ctx.organizationId, next)
      return { ok: true as const, data: { scope: parsed.scope, bytes: next.length } }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'append_failed',
      }
    }
  },
  formatHint: 'json',
})

export const memoryClearVerb = defineCliVerb({
  name: 'memory clear',
  description: 'Clear the memory blob (sets it to empty).',
  input: z.object({
    scope: z.enum(['agent', 'contact', 'staff']),
    id: z.string().optional(),
    agentId: z.string().optional(),
    staffId: z.string().optional(),
  }),
  body: async ({ input, ctx }) => {
    const parsed = ScopeSchema.parse(input)
    try {
      await writeMemory(parsed, ctx.organizationId, '')
      return { ok: true as const, data: { scope: parsed.scope, cleared: true } }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'clear_failed',
      }
    }
  },
  formatHint: 'json',
})

export const memoryVerbs = [memoryShowVerb, memoryAppendVerb, memoryClearVerb] as const
