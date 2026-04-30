import { isTimelineVisibleEvent } from '@/lib/activity-helpers'
import type { MessageRow } from '../pages/conversations/_components/types'

/** Filter out invisible activity events and sort by creation time (ascending). */
export function filterAndSortMessages<T extends MessageRow>(messages: T[]): T[] {
  return [...messages]
    .filter(
      (msg) =>
        msg.messageType !== 'activity' ||
        isTimelineVisibleEvent(((msg.contentData as Record<string, unknown>)?.eventType as string) ?? msg.content),
    )
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}
