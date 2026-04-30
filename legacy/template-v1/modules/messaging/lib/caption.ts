/**
 * Media captioning utilities for background processing of inbound media messages.
 *
 * - Images: vision model generates structured description with key data extraction
 * - Documents: binary formats use extractDocument() + plateToMarkdown(); text-readable
 *   files under 100KB are read directly (no AI call)
 * - Audio/Video: placeholder captions (v2 will add transcription)
 */

import { unlink } from 'node:fs/promises'
import type { StorageService } from '@vobase/core'
import { logger } from '@vobase/core'
import sharp from 'sharp'

import { models } from '../../agents/mastra/lib/models'
import { getChatModel } from '../../agents/mastra/lib/provider'
import { encodeToJpeg, extractDocument } from '../../knowledge-base/lib/extract'
import { plateToMarkdown } from '../../knowledge-base/lib/plate-serialize'

const CAPTION_PROMPT = `You are a precise visual analysis system for a customer service platform.
Describe this image concisely for a customer service agent. Focus on:
1. What the image shows (type: receipt, invoice, product photo, screenshot, ID document, etc.)
2. Any visible text — transcribe exactly (amounts, dates, names, reference numbers, line items)
3. Key data points relevant to customer service (totals, due dates, order numbers, product names)
Keep under 300 words. Be factual — no speculation about intent.`

/** Max file size for direct text reading (100KB). */
const TEXT_READ_MAX_BYTES = 100 * 1024

/** Extensions eligible for direct text reading (no AI call). */
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.yaml', '.yml', '.py', '.js', '.ts', '.html', '.css'])

/** Cache generateText import (heavy AI SDK dep — dynamic per project convention). */
let cachedGenerateText: typeof import('ai').generateText | null = null

async function getGenerateText() {
  if (!cachedGenerateText) {
    const { generateText } = await import('ai')
    cachedGenerateText = generateText
  }
  return cachedGenerateText
}

/**
 * Caption an image via vision model. Optimizes to JPEG first to reduce token cost.
 * Returns structured description string, or null on failure.
 */
export async function captionMedia(imageBuffer: Buffer): Promise<string | null> {
  try {
    const generateText = await getGenerateText()
    const { data: jpegBuffer } = await encodeToJpeg(sharp(imageBuffer))
    const base64 = jpegBuffer.toString('base64')

    const result = await generateText({
      model: getChatModel(models.gemini_flash),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: CAPTION_PROMPT },
            { type: 'image', image: `data:image/jpeg;base64,${base64}` },
          ],
        },
      ],
    })

    return result.text || null
  } catch (err) {
    logger.error('[caption] captionMedia failed', { error: err })
    return null
  }
}

/**
 * Caption a document by extracting its text content.
 *
 * Text-readable files (.txt, .md, .csv, etc.) under 100KB are read directly — no AI call.
 * Binary documents (PDF, DOCX, XLSX, PPTX) use extractDocument() + plateToMarkdown().
 */
export async function captionDocument(
  storageKey: string,
  mimeType: string,
  storage: StorageService,
): Promise<string | null> {
  const tmpPath = `/tmp/caption-${Date.now()}-${Math.random().toString(36).slice(2)}`

  try {
    const bucket = storage.bucket('chat-attachments')
    const data = await bucket.download(storageKey)
    const buffer = Buffer.from(data)

    // Text-readable files: read content directly if under size limit
    const ext = extractExtension(storageKey)
    if (ext && TEXT_EXTENSIONS.has(ext) && buffer.byteLength <= TEXT_READ_MAX_BYTES) {
      const text = new TextDecoder().decode(buffer).trim()
      return text || null
    }

    // Binary documents: extract via KB pipeline
    await Bun.write(tmpPath, buffer)

    const result = await extractDocument(tmpPath, mimeType)

    if (result.status === 'needs_ocr') {
      return null // Caller writes fallback
    }

    const markdown = plateToMarkdown(result.value)
    return markdown.trim() || null
  } catch (err) {
    logger.error('[caption] captionDocument failed', {
      storageKey,
      error: err,
    })
    return null
  } finally {
    try {
      await unlink(tmpPath)
    } catch {
      // Temp file may not exist if download failed
    }
  }
}

/**
 * Dispatcher: generate a caption for a given content type.
 * Returns caption string, or null if captioning failed or is not applicable.
 */
export async function getCaptionForContentType(
  contentType: string,
  storageKey: string | undefined,
  mimeType: string | undefined,
  storage: StorageService | undefined,
): Promise<string | null> {
  switch (contentType) {
    case 'image': {
      if (!storage || !storageKey) return null
      const bucket = storage.bucket('chat-attachments')
      const data = await bucket.download(storageKey)
      return captionMedia(Buffer.from(data))
    }

    case 'document':
      if (!storage || !storageKey || !mimeType) return null
      return captionDocument(storageKey, mimeType, storage)

    case 'audio':
      return '(voice message — transcription not yet available)'

    case 'video':
      return '(video — description not yet available)'

    default:
      return null
  }
}

/** Extract file extension from a storage key or filename. */
function extractExtension(key: string): string | null {
  const lastDot = key.lastIndexOf('.')
  if (lastDot === -1) return null
  return key.slice(lastDot).toLowerCase()
}
