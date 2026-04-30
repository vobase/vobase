/**
 * Plate Value diff — top-level block comparison only.
 *
 * Uses lodash.isEqual for a fast structural check, then falls back to
 * serialized markdown comparison (handles whitespace normalization and
 * mark reordering that would cause false positives with JSON comparison alone).
 *
 * Diff is positional (by index), not LCS. A change anywhere inside a table
 * or other block = full block re-chunk (intentional — sub-block diffing adds
 * complexity without meaningful embedding savings).
 */

import isEqual from 'lodash.isequal'

import { plateToMarkdown } from './plate-serialize'
import type { PlateValue } from './plate-types'

interface BlockRange {
  /** Inclusive start index in the PlateValue array */
  start: number
  /** Inclusive end index in the PlateValue array */
  end: number
}

interface PlateValueDiff {
  changed: BlockRange[]
  added: BlockRange[]
  removed: BlockRange[]
}

/**
 * Diff two Plate Values at the top-level block level.
 * Returns ranges of changed, added, and removed blocks.
 */
export function diffPlateValue(oldValue: PlateValue, newValue: PlateValue): PlateValueDiff {
  const changed: BlockRange[] = []
  const added: BlockRange[] = []
  const removed: BlockRange[] = []

  const oldLen = oldValue.length
  const newLen = newValue.length
  const minLen = Math.min(oldLen, newLen)

  for (let i = 0; i < minLen; i++) {
    // Fast path: structural equality
    if (isEqual(oldValue[i], newValue[i])) continue
    // Markdown comparison normalizes whitespace and mark ordering
    const oldMd = plateToMarkdown([oldValue[i]])
    const newMd = plateToMarkdown([newValue[i]])
    if (oldMd !== newMd) {
      changed.push({ start: i, end: i })
    }
  }

  if (newLen > oldLen) {
    added.push({ start: oldLen, end: newLen - 1 })
  } else if (oldLen > newLen) {
    removed.push({ start: newLen, end: oldLen - 1 })
  }

  return { changed, added, removed }
}

/** Returns true if a chunk's blockRange overlaps any of the affected ranges. */
export function isBlockRangeAffected(blockRange: [number, number], affectedRanges: BlockRange[]): boolean {
  return affectedRanges.some((r) => blockRange[0] <= r.end && blockRange[1] >= r.start)
}
