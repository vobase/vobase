import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';

/**
 * Result of document text extraction.
 * - ok: text was successfully extracted
 * - needs_ocr: document requires OCR but no API key is configured
 */
export interface ExtractionResult {
  text: string;
  status: 'ok' | 'needs_ocr';
  warning?: string;
}

const SCANNED_PDF_THRESHOLD = 100; // chars per page — below this, PDF is likely scanned

/**
 * Extract text from a file as Markdown. Dispatches to format-specific handlers.
 * Reads from a file path (temp file written by the upload handler).
 */
export async function extractDocument(
  filePath: string,
  mimeType: string,
): Promise<ExtractionResult> {
  const file = Bun.file(filePath);
  const buffer = await file.arrayBuffer();

  // PDF
  if (mimeType === 'application/pdf') {
    return extractPdf(buffer);
  }

  // DOCX
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return extractDocx(buffer);
  }

  // XLSX
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return extractXlsx(buffer);
  }

  // PPTX
  if (
    mimeType ===
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return extractPptx(buffer);
  }

  // Images
  if (mimeType.startsWith('image/')) {
    return extractImage(buffer, mimeType);
  }

  // HTML
  if (mimeType.startsWith('text/html')) {
    return extractHtml(buffer);
  }

  // Text-based fallback (txt, md, csv, json, xml, etc.)
  return { text: new TextDecoder().decode(buffer), status: 'ok' };
}

// --- Format Handlers ---

async function extractPdf(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text, totalPages } = await extractPdfText(pdf, { mergePages: false });
  const pages = text as string[];
  const totalChars = pages.reduce((sum, p) => sum + p.length, 0);
  const avgCharsPerPage = totalPages > 0 ? totalChars / totalPages : 0;

  // Text-based PDF — use local extraction
  if (avgCharsPerPage >= SCANNED_PDF_THRESHOLD) {
    return { text: pages.join('\n\n'), status: 'ok' };
  }

  // Scanned PDF — try Gemini OCR
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const ocrText = await ocrWithGemini(buffer, 'application/pdf');
    return { text: ocrText, status: 'ok' };
  }

  // No API key — return whatever text we got + warning
  return {
    text: pages.join('\n\n'),
    status: 'needs_ocr',
    warning:
      'Scanned PDF detected. Set GOOGLE_GENERATIVE_AI_API_KEY for OCR extraction.',
  };
}

async function extractDocx(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const mammoth = await import('mammoth');
  const TurndownService = (await import('turndown')).default;
  const { gfm } = await import('turndown-plugin-gfm');

  const { value: html } = await mammoth.convertToHtml({
    buffer: Buffer.from(buffer),
  });
  const turndown = new TurndownService({ headingStyle: 'atx' });
  turndown.use(gfm);
  const markdown = turndown.turndown(html);
  return { text: markdown, status: 'ok' };
}

async function extractXlsx(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer);
  const sheets: string[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
    }) as string[][];
    if (rows.length === 0) continue;

    const [header, ...body] = rows;
    const headerRow = `| ${header.map((h) => String(h ?? '')).join(' | ')} |`;
    const sepRow = `| ${header.map(() => '---').join(' | ')} |`;
    const dataRows = body.map(
      (row) => `| ${row.map((c) => String(c ?? '')).join(' | ')} |`,
    );
    sheets.push(
      `## Sheet: ${name}\n\n${headerRow}\n${sepRow}\n${dataRows.join('\n')}`,
    );
  }

  return { text: sheets.join('\n\n'), status: 'ok' };
}

async function extractPptx(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const { parseOffice } = await import('officeparser');
  const result = await parseOffice(Buffer.from(buffer));
  // officeparser v6 returns an AST object with toText() method
  const text = typeof result === 'string' ? result : result.toText();
  return { text, status: 'ok' };
}

async function extractImage(
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<ExtractionResult> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return {
      text: '',
      status: 'needs_ocr',
      warning: 'Image OCR requires GOOGLE_GENERATIVE_AI_API_KEY.',
    };
  }

  const ocrText = await ocrWithGemini(buffer, mimeType);
  return { text: ocrText, status: 'ok' };
}

async function extractHtml(buffer: ArrayBuffer): Promise<ExtractionResult> {
  const TurndownService = (await import('turndown')).default;
  const { gfm } = await import('turndown-plugin-gfm');

  const html = new TextDecoder().decode(buffer);
  const turndown = new TurndownService({ headingStyle: 'atx' });
  turndown.use(gfm);
  return { text: turndown.turndown(html), status: 'ok' };
}

// --- OCR Helper ---

async function ocrWithGemini(
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const { generateText } = await import('ai');
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');

  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  const model = google('gemini-flash-latest');
  const base64 = Buffer.from(buffer).toString('base64');

  const { text } = await generateText({
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'file',
            data: base64,
            mediaType: mimeType,
          },
          {
            type: 'text',
            text: 'Extract all text from this document. Return the content as well-structured Markdown with headers, lists, and tables preserved. Only return the extracted text, no commentary.',
          },
        ],
      },
    ],
  });

  return text;
}
