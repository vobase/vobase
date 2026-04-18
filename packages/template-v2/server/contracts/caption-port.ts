/**
 * CaptionPort — spec §6.5. Owned by the drive module; consumed by drive itself
 * and by channel adapters for inbound media. Implementation wraps Gemini.
 */
export interface CaptionPort {
  captionImage(url: string, hint?: string): Promise<string>
  captionVideo(url: string, hint?: string): Promise<string>
  extractText(url: string, mime: string): Promise<string>
}
