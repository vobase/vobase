import { describe, expect, it } from 'bun:test'

import { bookingCommands } from './booking'
import type { WakeContext } from './types'

const stubCtx = {} as WakeContext
const noFlags: Record<string, string> = {}

describe('booking commands', () => {
  describe('check-slots', () => {
    const cmd = bookingCommands['check-slots']

    it('returns slots for a weekday', async () => {
      // 2026-04-15 is a Wednesday
      const result = await cmd(['2026-04-15'], noFlags, stubCtx)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Available slots for 2026-04-15:')
      expect(result.stdout).toContain('9:00 AM')
      expect(result.stdout).toContain('4:00 PM')
      // Should have mix of ✓ and ✗
      expect(result.stdout).toContain('✓')
      expect(result.stdout).toContain('✗')
    })

    it('includes service name in header when provided', async () => {
      const result = await cmd(['2026-04-15'], { service: 'haircut' }, stubCtx)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Available slots for 2026-04-15 (haircut):')
    })

    it('returns morning-only slots for Saturday', async () => {
      // 2026-04-18 is a Saturday
      const result = await cmd(['2026-04-18'], noFlags, stubCtx)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('9:00 AM')
      expect(result.stdout).not.toContain('1:00 PM')
    })

    it('returns no slots for Sundays', async () => {
      // 2026-04-19 is a Sunday
      const result = await cmd(['2026-04-19'], noFlags, stubCtx)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('closed on Sundays')
    })

    it('errors on missing date', async () => {
      const result = await cmd([], noFlags, stubCtx)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Usage:')
    })

    it('errors on invalid date', async () => {
      const result = await cmd(['not-a-date'], noFlags, stubCtx)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Invalid date')
    })
  })

  describe('book', () => {
    const cmd = bookingCommands.book

    it('creates a booking with service and datetime', async () => {
      const result = await cmd(['2026-04-15T10:00:00Z'], { service: 'haircut' }, stubCtx)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^Booked: BK-.{8} — haircut at 2026-04-15T10:00:00Z$/)
    })

    it('includes notes when provided', async () => {
      const result = await cmd(['2026-04-15T10:00:00Z'], { service: 'massage', notes: 'Prefer deep tissue' }, stubCtx)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('massage at 2026-04-15T10:00:00Z')
      expect(result.stdout).toContain('Notes: Prefer deep tissue')
    })

    it('errors on missing datetime', async () => {
      const result = await cmd([], { service: 'haircut' }, stubCtx)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Usage:')
    })

    it('errors on missing service flag', async () => {
      const result = await cmd(['2026-04-15T10:00:00Z'], noFlags, stubCtx)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('--service')
    })

    it('errors on invalid datetime', async () => {
      const result = await cmd(['bad-time'], { service: 'haircut' }, stubCtx)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Invalid datetime')
    })
  })

  describe('reschedule', () => {
    const cmd = bookingCommands.reschedule

    it('reschedules a booking to a new datetime', async () => {
      const result = await cmd(['BK-ABC12345', '2026-04-16T14:00:00Z'], noFlags, stubCtx)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Rescheduled: BK-ABC12345 → 2026-04-16T14:00:00Z')
    })

    it('errors on missing arguments', async () => {
      const result = await cmd(['BK-ABC12345'], noFlags, stubCtx)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Usage:')
    })

    it('errors on missing booking ID', async () => {
      const result = await cmd([], noFlags, stubCtx)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Usage:')
    })

    it('errors on invalid datetime', async () => {
      const result = await cmd(['BK-ABC12345', 'bad-time'], noFlags, stubCtx)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Invalid datetime')
    })
  })

  describe('cancel', () => {
    const cmd = bookingCommands.cancel

    it('cancels a booking', async () => {
      const result = await cmd(['BK-ABC12345'], noFlags, stubCtx)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Cancelled: BK-ABC12345')
    })

    it('includes reason when provided', async () => {
      const result = await cmd(['BK-ABC12345'], { reason: 'Customer changed mind' }, stubCtx)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('Cancelled: BK-ABC12345 (Customer changed mind)')
    })

    it('errors on missing booking ID', async () => {
      const result = await cmd([], noFlags, stubCtx)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('Usage:')
    })
  })
})
