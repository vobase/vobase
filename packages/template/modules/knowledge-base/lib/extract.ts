import { PDFiumLibrary } from '@hyzyla/pdfium';
import { logger } from '@vobase/core';
import sharp from 'sharp';

import { bareModelName, models } from '../../../mastra/lib/models';
import { htmlToPlate, markdownToPlate } from './plate-deserialize';
import {
  createHeading,
  createParagraph,
  createTable,
  createTableCell,
  createTableRow,
  createText,
  type PlateElement,
  type PlateValue,
} from './plate-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractionResult {
  value: PlateValue;
  rawValue?: PlateValue;
  status: 'ok' | 'needs_ocr';
  warning?: string;
}

/** JPEG image buffer ready for Gemini OCR */
interface OcrImage {
  page: number;
  data: Buffer;
}

function emptyPlate(): PlateValue {
  return [createParagraph()];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RENDER_DPI = 300;
const RENDER_SCALE = RENDER_DPI / 72;
const MAX_IMAGE_DIMENSION = 3000;
const JPEG_QUALITY = 85;
/** Max total bytes per Gemini batch (safe margin under 20MB API limit) */
const MAX_BATCH_BYTES = 15 * 1024 * 1024;
const MIN_USEFUL_CHARS = 20;
/** Max pages to render concurrently (bounded to avoid WASM memory pressure) */
const RENDER_CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// OCR prompt — single source of truth
// ---------------------------------------------------------------------------

const OCR_PROMPT_BASE = [
  'You are a precise document OCR system.',
  'Transcribe all visible text exactly as it appears.',
  'Use Markdown formatting: headings (#), bold (**), lists (-), and tables (| col | col |) with header separators.',
  'IMPORTANT: Any tabular data MUST be formatted as a Markdown table with | pipes and a |---|---| header row. Never flatten table cells into separate lines.',
  'Transcribe only — no descriptions, no commentary, no preambles.',
  'If text is small or decorative, still transcribe it.',
].join(' ');

function buildOcrPrompt(batchContext?: string): string {
  if (!batchContext) return OCR_PROMPT_BASE;
  return `${OCR_PROMPT_BASE} Maintain the reading order across pages. Use --- between distinct page sections. ${batchContext}`;
}

// ---------------------------------------------------------------------------
// Lazy singletons (avoid repeated init/import overhead)
// ---------------------------------------------------------------------------

// Store promise (not resolved value) to avoid race on concurrent calls. Reset on error.
let pdfiumPromise: Promise<
  Awaited<ReturnType<typeof PDFiumLibrary.init>>
> | null = null;

function getPdfium() {
  if (!pdfiumPromise) {
    pdfiumPromise = PDFiumLibrary.init().catch((err) => {
      pdfiumPromise = null;
      throw err;
    });
  }
  return pdfiumPromise;
}

type GeminiOcr = {
  generateText: typeof import('ai').generateText;
  model: ReturnType<
    ReturnType<typeof import('@ai-sdk/google').createGoogleGenerativeAI>
  >;
};

// Cache generateText import (stable). Provider created fresh to pick up key changes.
let cachedGenText: typeof import('ai').generateText | null = null;

async function getGeminiOcr(): Promise<GeminiOcr> {
  if (!cachedGenText) {
    const { generateText } = await import('ai');
    cachedGenText = generateText;
  }
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  return {
    generateText: cachedGenText,
    model: google(bareModelName(models.gemini_flash)),
  };
}

function hasGeminiKey(): boolean {
  return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}

// ---------------------------------------------------------------------------
// Shared image processing
// ---------------------------------------------------------------------------

/** Resize (if needed) and encode to JPEG. Returns buffer + dimensions. */
async function encodeToJpeg(
  input: sharp.Sharp,
): Promise<{ data: Buffer; width: number; height: number }> {
  const meta = await input.metadata();
  if (
    (meta.width && meta.width > MAX_IMAGE_DIMENSION) ||
    (meta.height && meta.height > MAX_IMAGE_DIMENSION)
  ) {
    input = input.resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  const { data, info } = await input
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function extractDocument(
  filePath: string,
  mimeType: string,
): Promise<ExtractionResult> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();
  const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(1);

  logger.info('[kb] extract_start', { mimeType, sizeMB, filePath });

  if (mimeType === 'application/pdf') return extractPdf(buffer, sizeMB);

  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return extractDocx(buffer);

  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
    return extractXlsx(buffer);

  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )
    return extractPptx(buffer);

  if (mimeType.startsWith('image/')) return extractImage(buffer);

  if (mimeType.startsWith('text/html')) return extractHtml(buffer);

  // Text-based fallback
  const text = new TextDecoder().decode(buffer);
  const value = markdownToPlate(text || ' ');
  return { value, status: 'ok' };
}

// ---------------------------------------------------------------------------
// PDF: render pages → JPEG → batch to Gemini
// ---------------------------------------------------------------------------

async function renderPdfPages(buffer: ArrayBuffer): Promise<OcrImage[]> {
  const t0 = performance.now();
  const library = await getPdfium();
  const doc = await library.loadDocument(new Uint8Array(buffer));
  const pageCount = doc.getPageCount();

  logger.info('[kb] pdf_render_start', { pageCount });

  const pages: OcrImage[] = [];
  try {
    // Render pages with bounded concurrency
    for (let start = 0; start < pageCount; start += RENDER_CONCURRENCY) {
      const end = Math.min(start + RENDER_CONCURRENCY, pageCount);
      const batch = await Promise.all(
        Array.from({ length: end - start }, async (_, offset) => {
          const i = start + offset;
          const page = doc.getPage(i);
          const bitmap = await page.render({
            scale: RENDER_SCALE,
            render: 'bitmap',
          });
          const { data } = await encodeToJpeg(
            sharp(bitmap.data, {
              raw: {
                width: bitmap.width,
                height: bitmap.height,
                channels: 4,
              },
            }),
          );
          return { page: i + 1, data } satisfies OcrImage;
        }),
      );
      pages.push(...batch);
    }
  } finally {
    doc.destroy();
  }

  const totalBytes = pages.reduce((sum, p) => sum + p.data.byteLength, 0);
  logger.info('[kb] pdf_render_done', {
    pageCount,
    totalSizeMB: (totalBytes / 1024 / 1024).toFixed(1),
    avgPerPageKB: Math.round(totalBytes / pageCount / 1024),
    durationMs: Math.round(performance.now() - t0),
  });

  return pages;
}

function batchPages(pages: OcrImage[]): OcrImage[][] {
  const batches: OcrImage[][] = [];
  let current: OcrImage[] = [];
  let currentSize = 0;

  for (const page of pages) {
    if (
      current.length > 0 &&
      currentSize + page.data.byteLength > MAX_BATCH_BYTES
    ) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(page);
    currentSize += page.data.byteLength;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

async function extractPdf(
  buffer: ArrayBuffer,
  sizeMB: string,
): Promise<ExtractionResult> {
  if (!hasGeminiKey()) {
    logger.warn('[kb] pdf_extract_skip', { reason: 'no API key', sizeMB });
    return {
      value: emptyPlate(),
      status: 'needs_ocr',
      warning: 'PDF extraction requires GOOGLE_GENERATIVE_AI_API_KEY.',
    };
  }

  const t0 = performance.now();

  try {
    const pages = await renderPdfPages(buffer);
    const batches = batchPages(pages);
    const batchResults: string[] = [];

    logger.info('[kb] pdf_ocr_start', {
      pageCount: pages.length,
      batchCount: batches.length,
      sizeMB,
    });

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const pageRange = `${batch[0].page}-${batch[batch.length - 1].page}`;
      const batchContext =
        batches.length > 1
          ? `This is batch ${i + 1} of ${batches.length} (pages ${pageRange}). Continue from where the previous batch ended.`
          : '';

      const batchT0 = performance.now();
      const text = await ocrBatch(batch, batchContext);
      batchResults.push(text);

      logger.info('[kb] pdf_ocr_batch', {
        batch: i + 1,
        pages: pageRange,
        chars: text.length,
        durationMs: Math.round(performance.now() - batchT0),
      });
    }

    const combined = batchResults.join('\n\n');

    if (!isReadableText(combined)) {
      logger.warn('[kb] pdf_extract_unreadable', {
        chars: combined.length,
        durationMs: Math.round(performance.now() - t0),
      });
      return {
        value: emptyPlate(),
        status: 'needs_ocr',
        warning:
          'PDF extraction produced insufficient or unreadable text from Gemini.',
      };
    }

    const value = markdownToPlate(combined);
    logger.info('[kb] pdf_extract_done', {
      status: 'ok',
      chars: combined.length,
      blocks: value.length,
      durationMs: Math.round(performance.now() - t0),
    });
    return { value, status: 'ok' };
  } catch (error) {
    logger.error('[kb] pdf_extract_error', {
      error: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - t0),
    });
    return {
      value: emptyPlate(),
      status: 'needs_ocr',
      warning: `PDF extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Image: optimize → Gemini
// ---------------------------------------------------------------------------

async function extractImage(buffer: ArrayBuffer): Promise<ExtractionResult> {
  if (!hasGeminiKey()) {
    logger.warn('[kb] image_extract_skip', { reason: 'no API key' });
    return {
      value: emptyPlate(),
      status: 'needs_ocr',
      warning: 'Image OCR requires GOOGLE_GENERATIVE_AI_API_KEY.',
    };
  }

  const t0 = performance.now();
  const { data: optimized } = await encodeToJpeg(sharp(Buffer.from(buffer)));
  logger.info('[kb] image_optimize', {
    originalKB: Math.round(buffer.byteLength / 1024),
    optimizedKB: Math.round(optimized.byteLength / 1024),
  });

  const ocrText = await ocrBatch([{ page: 1, data: optimized }], '');
  const value = markdownToPlate(ocrText);
  logger.info('[kb] image_extract_done', {
    chars: ocrText.length,
    blocks: value.length,
    durationMs: Math.round(performance.now() - t0),
  });
  return { value, status: 'ok' };
}

// ---------------------------------------------------------------------------
// Other format handlers
// ---------------------------------------------------------------------------

async function extractDocx(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const mammoth = await import('mammoth');
  const { value: html } = await mammoth.convertToHtml({
    buffer: Buffer.from(buffer),
  });
  const value = htmlToPlate(html);
  return { value, status: 'ok' };
}

async function extractXlsx(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer);
  const blocks: PlateElement[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
    }) as string[][];
    if (rows.length === 0) continue;

    const [header, ...body] = rows;

    blocks.push(createHeading(2, [createText(`Sheet: ${name}`)]));

    const headerRow = createTableRow(
      header.map((h) => createTableCell([createText(String(h ?? ''))], true)),
    );
    const bodyRows = body.map((row) =>
      createTableRow(
        header.map((_, i) =>
          createTableCell([createText(String(row[i] ?? ''))]),
        ),
      ),
    );
    blocks.push(createTable([headerRow, ...bodyRows]));
  }

  const value: PlateValue = blocks.length > 0 ? blocks : [createParagraph()];
  return { value, status: 'ok' };
}

async function extractPptx(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const { parseOffice } = await import('officeparser');
  const result = await parseOffice(Buffer.from(buffer));
  const text = typeof result === 'string' ? result : result.toText();

  const slides = splitPptxSlides(text);
  const avgCharsPerSlide = slides.length > 0 ? text.length / slides.length : 0;

  if (hasGeminiKey() && avgCharsPerSlide < 50 && slides.length > 0) {
    try {
      const ocrText = await ocrFile(
        buffer,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      );
      const value = markdownToPlate(ocrText);
      return { value, status: 'ok' };
    } catch {
      // Fall through to text extraction
    }
  }

  const value = pptxTextToPlate(text, slides);
  return { value, status: 'ok' };
}

function splitPptxSlides(text: string): string[] {
  if (text.includes('\n---\n')) {
    return text
      .split('\n---\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const parts = text
    .split(/\n{3,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 1) return parts;
  return [text.trim()].filter(Boolean);
}

function pptxTextToPlate(text: string, slides: string[]): PlateValue {
  if (slides.length <= 1) return markdownToPlate(text || ' ');

  const blocks: PlateElement[] = [];
  for (let i = 0; i < slides.length; i++) {
    blocks.push(createHeading(2, [createText(`Slide ${i + 1}`)]));
    const lines = slides[i].split('\n').filter((l) => l.trim());
    for (const line of lines) {
      blocks.push(createParagraph([createText(line)]));
    }
  }
  return blocks.length > 0 ? blocks : [createParagraph()];
}

async function extractHtml(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const html = new TextDecoder().decode(buffer);
  const value = htmlToPlate(html);
  return { value, status: 'ok' };
}

// ---------------------------------------------------------------------------
// Text validation
// ---------------------------------------------------------------------------

function isReadableText(text: string): boolean {
  if (text.trim().length < MIN_USEFUL_CHARS) return false;
  let printable = 0;
  let total = 0;
  // Use codePointAt to handle surrogate pairs (emoji, CJK Extension B, etc.)
  for (let i = 0; i < text.length; ) {
    const code = text.codePointAt(i) ?? 0;
    total++;
    if ((code >= 0x20 && code < 0x7f) || code >= 0xa0) {
      printable++;
    }
    i += code > 0xffff ? 2 : 1;
  }
  return total > 0 && printable / total >= 0.6;
}

// ---------------------------------------------------------------------------
// Gemini OCR
// ---------------------------------------------------------------------------

/** Send a batch of images to Gemini. Falls back to per-page on content filter. */
async function ocrBatch(
  pages: OcrImage[],
  batchContext: string,
): Promise<string> {
  const { generateText, model } = await getGeminiOcr();

  const imageParts = pages.map((p) => ({
    type: 'image' as const,
    image: p.data,
    mimeType: 'image/jpeg' as const,
  }));

  const { text, finishReason } = await generateText({
    model,
    messages: [
      {
        role: 'user',
        content: [
          ...imageParts,
          { type: 'text' as const, text: buildOcrPrompt(batchContext) },
        ],
      },
    ],
  });

  if (finishReason === 'content-filter' || (!text && pages.length > 1)) {
    logger.warn('[kb] ocr_batch_filter', {
      finishReason,
      pageCount: pages.length,
    });
    // Retry pages individually — fall back to GPT on content-filter
    const parts: string[] = [];
    for (const page of pages) {
      const { text: pageText, finishReason: pageFinish } = await generateText({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image' as const, image: page.data },
              { type: 'text' as const, text: buildOcrPrompt() },
            ],
          },
        ],
      });
      if (pageFinish === 'content-filter') {
        logger.warn('[kb] ocr_page_filter_fallback', {
          page: page.page,
          fallback: 'gpt_mini',
        });
        const fallbackText = await ocrWithFallback(page, generateText);
        if (fallbackText) parts.push(fallbackText);
      } else {
        parts.push(pageText);
      }
    }
    return parts.filter(Boolean).join('\n\n');
  }

  return text;
}

/** Send a raw file buffer to Gemini (for PPTX where page rendering isn't available). */
async function ocrFile(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  const { generateText, model } = await getGeminiOcr();
  const base64 = Buffer.from(buffer).toString('base64');

  const { text } = await generateText({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'file', data: base64, mediaType: mimeType },
          { type: 'text', text: buildOcrPrompt() },
        ],
      },
    ],
  });

  return text;
}

// Cache OpenAI import (stable). Provider created fresh to pick up key changes.
let cachedCreateOpenAI: typeof import('@ai-sdk/openai').createOpenAI | null =
  null;

/** Fallback OCR via OpenAI when Gemini content-filters an image. */
async function ocrWithFallback(
  page: OcrImage,
  genText: typeof import('ai').generateText,
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('[kb] ocr_fallback_skip', {
      page: page.page,
      reason: 'no OPENAI_API_KEY',
    });
    return '';
  }
  try {
    if (!cachedCreateOpenAI) {
      const mod = await import('@ai-sdk/openai');
      cachedCreateOpenAI = mod.createOpenAI;
    }
    const openai = cachedCreateOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const fallbackModel = openai(bareModelName(models.gpt_mini));

    const { text } = await genText({
      model: fallbackModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image' as const, image: page.data },
            { type: 'text' as const, text: buildOcrPrompt() },
          ],
        },
      ],
    });
    logger.info('[kb] ocr_fallback_done', {
      page: page.page,
      model: models.gpt_mini,
      chars: text.length,
    });
    return text;
  } catch (error) {
    logger.error('[kb] ocr_fallback_error', {
      page: page.page,
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}
