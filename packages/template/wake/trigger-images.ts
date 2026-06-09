/**
 * Resolve the image attachments of an inbound-message wake into pi-ai
 * `ImageContent` blocks for the first user turn, so a vision-capable model
 * actually SEES the customer's photo instead of a `[image]` placeholder.
 *
 * Wired into the conversation wake via the harness `renderTriggerImages` seam
 * (mirrors `renderTrigger`). The image bytes already live in drive storage
 * (the channel adapter downloaded + ingested them at inbound time); this only
 * reads them — no new write path.
 *
 * Keyed off attachment `mimeType` (`image/*`), so an image a customer sends as
 * a WhatsApp *document* is still treated as vision. Bounded by `IMAGE_BUDGET`
 * so a flood of large images can't blow up token cost; oversized or
 * unreadable items are skipped, never fatal.
 */

import type { ImageContent } from '@mariozechner/pi-ai'
import { DRIVE_STORAGE_BUCKET } from '@modules/drive/constants'
import type { DriveFile } from '@modules/drive/schema'
import type { MessageAttachmentRef } from '@modules/drive/service/types'

import type { AppStorage } from '~/runtime'
import type { WakeTrigger } from './events'

export interface ImageBudget {
  /** Max images delivered to the model in a single wake. */
  maxImages: number
  /** Per-image byte ceiling; larger attachments are skipped (not fatal). */
  maxImageBytes: number
  /** Cumulative byte ceiling across all images in the wake. */
  maxTotalBytes: number
}

/**
 * Conservative defaults. The inbound media cap is 25MB in `@vobase/core`, so a
 * single legitimate attachment can exceed `maxImageBytes` and get skipped —
 * intended.
 */
export const IMAGE_BUDGET: ImageBudget = {
  maxImages: 4,
  maxImageBytes: 5 * 1024 * 1024,
  maxTotalBytes: 15 * 1024 * 1024,
}

export interface ResolveTriggerImagesCtx {
  /** Load the attachment refs for the wake's triggering message ids. */
  loadAttachments: (messageIds: readonly string[]) => Promise<readonly MessageAttachmentRef[]>
  /** Drive file lookup — supplies the `storageKey` for a `driveFileId`. */
  drive: { get: (id: string) => Promise<DriveFile | null> }
  /** Object storage; `null` when storage is unconfigured (skip vision). */
  storage: AppStorage | null
  budget?: ImageBudget
}

export async function resolveTriggerImages(
  trigger: WakeTrigger | undefined,
  ctx: ResolveTriggerImagesCtx,
): Promise<ImageContent[]> {
  if (!trigger || trigger.trigger !== 'inbound_message' || !ctx.storage) return []

  const refs = await ctx.loadAttachments(trigger.messageIds)
  const images = refs.filter((r) => r.mimeType.startsWith('image/'))
  if (images.length === 0) return []

  const budget = ctx.budget ?? IMAGE_BUDGET
  const out: ImageContent[] = []
  let totalBytes = 0

  for (const ref of images) {
    if (out.length >= budget.maxImages) break
    if (ref.sizeBytes > budget.maxImageBytes) continue
    if (totalBytes + ref.sizeBytes > budget.maxTotalBytes) continue
    try {
      const row = await ctx.drive.get(ref.driveFileId)
      if (!row?.storageKey) continue
      const bytes = await ctx.storage.bucket(DRIVE_STORAGE_BUCKET).download(row.storageKey)
      out.push({ type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: ref.mimeType })
      totalBytes += bytes.length
    } catch (err) {
      console.warn(`[wake] resolveTriggerImages: skipping unreadable image ${ref.driveFileId}`, err)
    }
  }

  return out
}
