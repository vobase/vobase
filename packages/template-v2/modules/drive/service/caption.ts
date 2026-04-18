/**
 * CaptionPort implementation.
 * Returns stub "[caption pending]" when CAPTION_PROVIDER env is unset (Phase 1).
 */
import type { CaptionPort } from '@server/contracts/caption-port'

export function createCaptionPort(): CaptionPort {
  const provider = process.env.CAPTION_PROVIDER

  if (!provider) {
    return {
      async captionImage(_url, _hint) {
        return '[caption pending]'
      },
      async captionVideo(_url, _hint) {
        return '[caption pending]'
      },
      async extractText(_url, _mime) {
        return '[caption pending]'
      },
    }
  }

  // Phase 2: wire real Gemini caption provider
  throw new Error('not-implemented-in-phase-1: caption provider not yet wired')
}
