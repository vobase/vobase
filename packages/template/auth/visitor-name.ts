/**
 * Serial visitor names for anonymous sessions — "Visitor B001", "Visitor B002", …
 *
 * Wired into the better-auth `anonymous` plugin's `generateName` hook (see
 * `auth/plugins.ts`). The name is a per-day serial: a day-of-week letter
 * (Mon=A … Sun=G) plus a zero-padded counter that resets every day, so
 * Tuesday's first anonymous visitor is "Visitor B001".
 *
 * The counter is a gap-free sequence backed by core's `infra.sequences`
 * table — one row per `VIS-<letter>-<yyyymmdd>` prefix. Concurrent
 * anonymous sign-ins serialise through the row's `ON CONFLICT DO UPDATE`.
 */

import { sequences } from '@vobase/core'
import { sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

/** Day-of-week → letter. `Intl` weekday short names key this map. */
const WEEKDAY_LETTER: Record<string, string> = {
  Mon: 'A',
  Tue: 'B',
  Wed: 'C',
  Thu: 'D',
  Fri: 'E',
  Sat: 'F',
  Sun: 'G',
}

/** Timezone the daily counter resets against. */
const TZ = process.env.TZ || 'Asia/Singapore'

/** Hoisted — `Intl.DateTimeFormat` construction is comparatively expensive. */
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
})

/** Build the tz-local day letter + `yyyymmdd` date key for the sequence prefix. */
function visitorDayInfo(now = new Date()): { letter: string; dateKey: string } {
  const parts = DAY_FORMAT.formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? ''
  return {
    letter: WEEKDAY_LETTER[get('weekday')] ?? 'A',
    dateKey: `${get('year')}${get('month')}${get('day')}`,
  }
}

/** Atomically bump (and create-if-absent) the counter for `prefix`, returning the new value. */
async function nextSequence(db: ScopedDb, prefix: string): Promise<number> {
  const [row] = await db
    .insert(sequences)
    .values({ prefix, currentValue: 1 })
    .onConflictDoUpdate({
      target: sequences.prefix,
      set: { currentValue: sql`${sequences.currentValue} + 1` },
    })
    .returning({ currentValue: sequences.currentValue })
  if (!row) throw new Error(`visitor-name: sequence bump for "${prefix}" returned no row`)
  return row.currentValue
}

/** Generate the next serial visitor name, e.g. "Visitor B001". */
export async function generateVisitorName(db: ScopedDb): Promise<string> {
  const { letter, dateKey } = visitorDayInfo()
  const seq = await nextSequence(db, `VIS-${letter}-${dateKey}`)
  return `Visitor ${letter}${String(seq).padStart(3, '0')}`
}
