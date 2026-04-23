/**
 * Snooze preset definitions + target-time resolver.
 *
 * Presets: `1h | 3h | tomorrow 9am | next Monday 9am | this weekend | custom`.
 * Timezone is the staff user's tz — passed in from the client via
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` (no server-side profile yet).
 */

import {
  addDays,
  addHours,
  nextMonday,
  nextSaturday,
  setHours,
  setMilliseconds,
  setMinutes,
  setSeconds,
} from 'date-fns'

export type SnoozePresetId = '1h' | '3h' | 'tomorrow_9am' | 'next_monday_9am' | 'this_weekend' | 'custom'

export interface SnoozePreset {
  id: Exclude<SnoozePresetId, 'custom'>
  label: string
}

export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  { id: '1h', label: 'In 1 hour' },
  { id: '3h', label: 'In 3 hours' },
  { id: 'tomorrow_9am', label: 'Tomorrow, 9:00 AM' },
  { id: 'next_monday_9am', label: 'Next Monday, 9:00 AM' },
  { id: 'this_weekend', label: 'This weekend' },
] as const

function atNineAm(d: Date): Date {
  return setMilliseconds(setSeconds(setMinutes(setHours(d, 9), 0), 0), 0)
}

/**
 * Compute the wake target for a preset.
 *
 * Timezones: the caller is responsible for computing `now` in the user's tz.
 * For simple "+N hours" presets the tz is irrelevant. For "tomorrow 9am" /
 * "next Monday 9am" the caller must pass `now` already shifted into the user's
 * tz, and the returned Date is the wall-clock target which the caller
 * converts back to UTC at the boundary. This avoids pulling in date-fns-tz
 * here — the UI layer handles the tz shift.
 */
export function computeSnoozeTarget(preset: Exclude<SnoozePresetId, 'custom'>, now: Date): Date {
  switch (preset) {
    case '1h':
      return addHours(now, 1)
    case '3h':
      return addHours(now, 3)
    case 'tomorrow_9am':
      return atNineAm(addDays(now, 1))
    case 'next_monday_9am': {
      // `nextMonday` returns the next Monday AFTER `now`. Safe on Sundays (returns +1d).
      return atNineAm(nextMonday(now))
    }
    case 'this_weekend':
      return atNineAm(nextSaturday(now))
    default: {
      const exhaustive: never = preset
      throw new Error(`unknown snooze preset: ${String(exhaustive)}`)
    }
  }
}
