import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, mock } from 'bun:test';

// Mock Gemini OCR — don't make real API calls in tests
mock.module('ai', () => ({
  generateText: async () => ({ text: 'OCR extracted text from Gemini' }),
}));
mock.module('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => () => ({}),
  google: () => ({}),
}));

const { extractDocument } = await import('./extract');

const FIXTURES_DIR = join(import.meta.dir, '__fixtures__');
const TMP_DIR = join(process.cwd(), 'data', 'test-tmp');

describe('extractDocument()', () => {
  afterEach(() => {
    // Clean up any temp files
    try {
      const { readdirSync } = require('node:fs');
      for (const f of readdirSync(TMP_DIR)) {
        try {
          unlinkSync(join(TMP_DIR, f));
        } catch {}
      }
    } catch {}
  });

  function writeTmpFixture(name: string, content: string | Buffer): string {
    mkdirSync(TMP_DIR, { recursive: true });
    const path = join(TMP_DIR, name);
    writeFileSync(path, content);
    return path;
  }

  describe('text formats', () => {
    it('extracts plain text from .txt files', async () => {
      const path = writeTmpFixture('test.txt', 'Hello, world!');
      const result = await extractDocument(path, 'text/plain');
      expect(result.status).toBe('ok');
      expect(result.text).toBe('Hello, world!');
    });

    it('extracts markdown from .md files', async () => {
      const path = writeTmpFixture('test.md', '# Title\n\nSome content');
      const result = await extractDocument(path, 'text/markdown');
      expect(result.status).toBe('ok');
      expect(result.text).toContain('# Title');
    });

    it('extracts CSV content', async () => {
      const path = writeTmpFixture('test.csv', 'name,age\nAlice,30\nBob,25');
      const result = await extractDocument(path, 'text/csv');
      expect(result.status).toBe('ok');
      expect(result.text).toContain('Alice');
    });
  });

  describe('PDF extraction', () => {
    it('extracts text from a real PDF fixture', async () => {
      const pdfPath = join(FIXTURES_DIR, 'fake-memo.pdf');
      const result = await extractDocument(pdfPath, 'application/pdf');
      expect(result.status).toBe('ok');
      expect(result.text.length).toBeGreaterThan(50);
      // The fake memo should contain some text content
      expect(result.text).toBeTruthy();
    });
  });

  describe('DOCX extraction', () => {
    it('extracts text from a real DOCX fixture', async () => {
      const docxPath = join(FIXTURES_DIR, 'simple.docx');
      const result = await extractDocument(
        docxPath,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(result.status).toBe('ok');
      expect(result.text.length).toBeGreaterThan(10);
      expect(result.text).toBeTruthy();
    });
  });

  describe('XLSX extraction', () => {
    it('extracts data from a real XLSX fixture as markdown table', async () => {
      const xlsxPath = join(FIXTURES_DIR, 'stanley-cups.xlsx');
      const result = await extractDocument(
        xlsxPath,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result.status).toBe('ok');
      // Should contain markdown table syntax
      expect(result.text).toContain('|');
      expect(result.text).toContain('---');
      // Should contain sheet header
      expect(result.text).toContain('## Sheet:');
    });
  });

  describe('PPTX extraction', () => {
    it('extracts text from a real PPTX fixture', async () => {
      const pptxPath = join(FIXTURES_DIR, 'simple.pptx');
      const result = await extractDocument(
        pptxPath,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      );
      expect(result.status).toBe('ok');
      expect(result.text.length).toBeGreaterThan(5);
    });
  });

  describe('HTML extraction', () => {
    it('converts real HTML fixture to markdown', async () => {
      const htmlPath = join(FIXTURES_DIR, 'fake-html.html');
      const result = await extractDocument(htmlPath, 'text/html');
      expect(result.status).toBe('ok');
      expect(result.text.length).toBeGreaterThan(10);
    });

    it('converts inline HTML to markdown with structure', async () => {
      const html =
        '<h1>Title</h1><p>Paragraph</p><ul><li>Item 1</li><li>Item 2</li></ul>';
      const path = writeTmpFixture('test.html', html);
      const result = await extractDocument(path, 'text/html');
      expect(result.status).toBe('ok');
      expect(result.text).toContain('Title');
      expect(result.text).toContain('Paragraph');
    });

    it('preserves tables via GFM plugin', async () => {
      const html =
        '<table><thead><tr><th>Name</th><th>Age</th></tr></thead><tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>';
      const path = writeTmpFixture('table.html', html);
      const result = await extractDocument(path, 'text/html');
      expect(result.status).toBe('ok');
      expect(result.text).toContain('Name');
      expect(result.text).toContain('Alice');
    });
  });

  describe('image extraction', () => {
    it('returns needs_ocr when no API key is set', async () => {
      const originalKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const imgPath = join(FIXTURES_DIR, 'document-screenshot.jpg');
      const result = await extractDocument(imgPath, 'image/jpeg');
      expect(result.status).toBe('needs_ocr');
      expect(result.warning).toContain('GEMINI_API_KEY');

      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    });

    it('uses Gemini OCR when API key is set', async () => {
      const originalKey = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'test-key';

      const imgPath = join(FIXTURES_DIR, 'document-screenshot.jpg');
      const result = await extractDocument(imgPath, 'image/jpeg');
      expect(result.status).toBe('ok');
      expect(result.text).toBe('OCR extracted text from Gemini');

      if (originalKey) process.env.GEMINI_API_KEY = originalKey;
      else delete process.env.GEMINI_API_KEY;
    });
  });

  describe('ExtractionResult shape', () => {
    it('always returns text, status, and optional warning', async () => {
      const path = writeTmpFixture('shape.txt', 'content');
      const result = await extractDocument(path, 'text/plain');
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('status');
      expect(typeof result.text).toBe('string');
      expect(['ok', 'needs_ocr']).toContain(result.status);
    });
  });
});
