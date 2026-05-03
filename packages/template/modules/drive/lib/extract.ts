/**
 * File extraction — magic-byte sniff + extension routing → markdown body or
 * binary-stub passthrough.
 *
 * Precedence:
 *   1. `EXTRACTABLE_MAX_BYTES` cap → binary-stub (extraction not attempted).
 *   2. Magic-byte sniff (PDF / JPEG / PNG / GIF / WebP / RIFF) → trust magic.
 *   3. Zip family (`PK\x03\x04`) → trust extension (docx/xlsx/pptx/odt → extract;
 *      raw .zip → binary-stub).
 *   4. Mime + extension hints (text/plain, text/markdown, application/json…).
 *   5. Otherwise → binary-stub.
 *
 * Extracted output is always a markdown string. Image extracts route through
 * `lib/ocr-provider.ts` which the caller injects (lets the job stub OCR in
 * tests).
 */

import { EXTRACTABLE_MAX_BYTES } from '../constants'
import { type RenderStubInput, renderStub } from './stub-markdown'

export type ExtractResult =
  | { kind: 'extracted'; markdown: string; ocrSummary?: string }
  | { kind: 'binary-stub'; markdown: string }
  | { kind: 'failed'; error: string }

export interface ExtractInput {
  bytes: Buffer | Uint8Array
  mimeType: string
  /** Original filename — used for ext disambiguation on zip-family containers. */
  originalName: string
  /** Inputs forwarded into `renderStub` when we route to binary-stub. */
  stub: RenderStubInput
  /** Optional injected OCR provider; the job binds the real one, tests stub it. */
  ocr?: (buffer: Buffer | Uint8Array, mime: string) => Promise<{ summary: string; text: string }>
}

/** Sniff the first 4 bytes for a unique magic. Returns the resolved mime or null. */
export function sniffMagicBytes(bytes: Buffer | Uint8Array): string | null {
  if (bytes.length < 4) return null
  const b0 = bytes[0]
  const b1 = bytes[1]
  const b2 = bytes[2]
  const b3 = bytes[3]
  // %PDF
  if (b0 === 0x25 && b1 === 0x50 && b2 === 0x44 && b3 === 0x46) return 'application/pdf'
  // \xFF\xD8\xFF — JPEG
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'image/jpeg'
  // \x89PNG
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'image/png'
  // GIF8
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38) return 'image/gif'
  // RIFF (need to also peek WEBP at offset 8)
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46) {
    if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return 'image/webp'
    }
    return null
  }
  // PK\x03\x04 — zip family (caller disambiguates via ext)
  if (b0 === 0x50 && b1 === 0x4b && b2 === 0x03 && b3 === 0x04) return 'application/zip'
  return null
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const ZIP_FAMILY_EXT_TO_MIME: Readonly<Record<string, string>> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
}

/**
 * Resolve the effective mime — combining magic bytes with extension when the
 * magic is ambiguous (zip family). Returns the resolved mime (which may equal
 * the input) or `null` if we should treat the file as a binary stub.
 */
export function resolveEffectiveMime(input: ExtractInput): string {
  const sniffed = sniffMagicBytes(input.bytes)
  if (sniffed === 'application/zip') {
    const ext = extOf(input.originalName)
    return ZIP_FAMILY_EXT_TO_MIME[ext] ?? 'application/zip'
  }
  if (sniffed) return sniffed
  return input.mimeType
}

function extractText(bytes: Buffer | Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

async function extractDocx(bytes: Buffer | Uint8Array): Promise<string> {
  // biome-ignore lint/plugin/no-dynamic-import: heavy office parser; backend-only, kept out of frontend bundle.
  const mammoth = (await import('mammoth')) as unknown as {
    extractRawText(args: { buffer: Buffer }): Promise<{ value: string }>
  }
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
  return value
}

async function extractXlsx(bytes: Buffer | Uint8Array): Promise<string> {
  // biome-ignore lint/plugin/no-dynamic-import: heavy xlsx parser; backend-only, kept out of frontend bundle.
  const xlsxMod = (await import('xlsx')) as unknown as {
    read(b: Buffer | ArrayBuffer): {
      SheetNames: string[]
      Sheets: Record<string, unknown>
    }
    utils: {
      sheet_to_csv(ws: unknown): string
    }
  }
  const wb = xlsxMod.read(Buffer.from(bytes))
  const lines: string[] = []
  for (const name of wb.SheetNames) {
    lines.push(`## ${name}`)
    const ws = wb.Sheets[name]
    if (ws) lines.push(xlsxMod.utils.sheet_to_csv(ws))
    lines.push('')
  }
  return lines.join('\n')
}

async function extractOffice(bytes: Buffer | Uint8Array): Promise<string> {
  // biome-ignore lint/plugin/no-dynamic-import: heavy office parser; backend-only, kept out of frontend bundle.
  const officeparser = (await import('officeparser')) as unknown as {
    parseOfficeAsync(buf: Buffer): Promise<string>
  }
  return officeparser.parseOfficeAsync(Buffer.from(bytes))
}

async function extractPdf(
  bytes: Buffer | Uint8Array,
  ocr: ExtractInput['ocr'],
): Promise<{ markdown: string; ocrSummary?: string }> {
  // biome-ignore lint/plugin/no-dynamic-import: heavy PDFium WASM module; backend-only and lazy-loaded so it doesn't blow up the worker startup time.
  const pdfium = (await import('@hyzyla/pdfium')) as unknown as {
    PDFiumLibrary: { init(): Promise<PdfiumLibInstance> }
  }
  const lib = await pdfium.PDFiumLibrary.init()
  const doc = await lib.loadDocument(Buffer.from(bytes) as unknown as Uint8Array)
  try {
    const pageCount = doc.getPageCount()
    const segments: string[] = []
    let usedOcr = false
    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i)
      const text = (await page.getText()).trim()
      if (text.length > 0) {
        segments.push(`## Page ${i + 1}\n\n${text}`)
        continue
      }
      // Image-only page → fall back to OCR provider.
      if (!ocr) {
        segments.push(`## Page ${i + 1}\n\n_(no extractable text; OCR not configured)_`)
        continue
      }
      const bitmap = await page.render({ scale: 2, render: 'bitmap' })
      // Encode bitmap as PNG for OCR call. We use sharp lazily so the import
      // doesn't run when the PDF is text-only.
      // biome-ignore lint/plugin/no-dynamic-import: heavy native image lib; loaded only when a PDF page actually needs OCR.
      const sharpMod = (await import('sharp')).default
      const png = await sharpMod(Buffer.from(bitmap.data), {
        raw: { width: bitmap.width, height: bitmap.height, channels: 4 },
      })
        .png()
        .toBuffer()
      const ocrResult = await ocr(png, 'image/png')
      usedOcr = true
      const block = ocrResult.text.length > 0 ? ocrResult.text : `_(${ocrResult.summary})_`
      segments.push(`## Page ${i + 1}\n\n${block}`)
    }
    return { markdown: segments.join('\n\n'), ocrSummary: usedOcr ? 'OCR-extracted PDF' : undefined }
  } finally {
    doc.destroy()
  }
}

async function extractImage(
  bytes: Buffer | Uint8Array,
  mime: string,
  ocr: ExtractInput['ocr'],
): Promise<{ markdown: string; ocrSummary?: string }> {
  if (!ocr) {
    return { markdown: '_(image extraction requires OCR provider)_' }
  }
  const result = await ocr(bytes, mime)
  const body = result.text.length > 0 ? result.text : `_${result.summary}_`
  return { markdown: body, ocrSummary: result.summary }
}

/** Sniff image dimensions (used in metadata; non-fatal). */
export async function sniffImageDimensions(
  bytes: Buffer | Uint8Array,
): Promise<{ width: number; height: number } | null> {
  try {
    // biome-ignore lint/plugin/no-dynamic-import: heavy native image lib; deferred to keep cold-start fast.
    const sharpMod = (await import('sharp')).default
    const meta = await sharpMod(Buffer.from(bytes)).metadata()
    if (typeof meta.width === 'number' && typeof meta.height === 'number') {
      return { width: meta.width, height: meta.height }
    }
    return null
  } catch {
    return null
  }
}

/** Top-level entry point. Returns a discriminated result the caller branches on. */
export async function extract(input: ExtractInput): Promise<ExtractResult> {
  // Size cap.
  if (input.bytes.length > EXTRACTABLE_MAX_BYTES) {
    return { kind: 'binary-stub', markdown: renderStub(input.stub) }
  }

  const effective = resolveEffectiveMime(input)
  try {
    // PDF
    if (effective === 'application/pdf') {
      const { markdown, ocrSummary } = await extractPdf(input.bytes, input.ocr)
      return { kind: 'extracted', markdown, ocrSummary }
    }
    // Office
    if (effective === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return { kind: 'extracted', markdown: await extractDocx(input.bytes) }
    }
    if (effective === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      return { kind: 'extracted', markdown: await extractXlsx(input.bytes) }
    }
    if (
      effective === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      effective === 'application/vnd.oasis.opendocument.text' ||
      effective === 'application/msword' ||
      effective === 'application/vnd.ms-excel' ||
      effective === 'application/vnd.ms-powerpoint'
    ) {
      return { kind: 'extracted', markdown: await extractOffice(input.bytes) }
    }
    // Images
    if (effective.startsWith('image/')) {
      const { markdown, ocrSummary } = await extractImage(input.bytes, effective, input.ocr)
      return { kind: 'extracted', markdown, ocrSummary }
    }
    // Plain text-ish
    if (
      effective === 'text/plain' ||
      effective === 'text/markdown' ||
      effective === 'text/csv' ||
      effective === 'text/html' ||
      effective === 'application/json' ||
      effective === 'application/xml'
    ) {
      return { kind: 'extracted', markdown: extractText(input.bytes) }
    }
    // Anything else → binary stub.
    return { kind: 'binary-stub', markdown: renderStub(input.stub) }
  } catch (err) {
    return { kind: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── pdfium private types ──────────────────────────────────────────────────

interface PdfiumLibInstance {
  loadDocument(bytes: Uint8Array): Promise<PdfiumDocument>
}

interface PdfiumDocument {
  getPageCount(): number
  getPage(index: number): PdfiumPage
  destroy(): void
}

interface PdfiumPage {
  getText(): Promise<string>
  render(opts: { scale: number; render: 'bitmap' }): Promise<{ data: Uint8Array; width: number; height: number }>
}
