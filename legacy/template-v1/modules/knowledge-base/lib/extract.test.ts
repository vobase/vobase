import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, mock } from 'bun:test'

// Mock Gemini OCR — don't make real API calls in tests
mock.module('ai', () => ({
  generateText: async () => ({
    text: '# OCR Result\n\nOCR extracted text from Gemini',
  }),
}))
mock.module('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => () => ({}),
  google: () => ({}),
}))

// Mock pdfium — don't load WASM in tests
const fakePage = {
  getSize: () => ({
    width: 100,
    height: 100,
    originalWidth: 100,
    originalHeight: 100,
  }),
  render: async () => ({
    width: 100,
    height: 100,
    data: new Uint8Array(100 * 100 * 4), // RGBA
  }),
}
mock.module('@hyzyla/pdfium', () => ({
  PDFiumLibrary: {
    init: async () => ({
      loadDocument: async () => ({
        getPageCount: () => 1,
        getPage: () => fakePage,
        destroy: () => {},
      }),
      destroy: () => {},
    }),
  },
}))

// Mock sharp — return a small JPEG buffer
const fakeJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const fakeSharpInstance: Record<string, unknown> = {
  resize: () => fakeSharpInstance,
  jpeg: () => fakeSharpInstance,
  metadata: async () => ({ width: 100, height: 100 }),
  toBuffer: async (opts?: { resolveWithObject?: boolean }) =>
    opts?.resolveWithObject ? { data: fakeJpeg, info: { width: 100, height: 100 } } : fakeJpeg,
}
mock.module('sharp', () => ({
  default: () => fakeSharpInstance,
}))

const { extractDocument } = await import('./extract')
const { markdownToPlate } = await import('./plate-deserialize')
const { plateToMarkdown } = await import('./plate-serialize')
const { plateValueSchema } = await import('./plate-types')

const FIXTURES_DIR = join(import.meta.dir, '__fixtures__')
const TMP_DIR = join(process.cwd(), 'data', 'test-tmp')

function writeTmpFixture(name: string, content: string | Buffer): string {
  mkdirSync(TMP_DIR, { recursive: true })
  const path = join(TMP_DIR, name)
  writeFileSync(path, content)
  return path
}

describe('extractDocument()', () => {
  afterEach(() => {
    try {
      const { readdirSync } = require('node:fs')
      for (const f of readdirSync(TMP_DIR)) {
        try {
          unlinkSync(join(TMP_DIR, f))
        } catch {}
      }
    } catch {}
  })

  describe('ExtractionResult shape', () => {
    it('returns value and status on success', async () => {
      const path = writeTmpFixture('shape.txt', 'Hello world')
      const result = await extractDocument(path, 'text/plain')
      expect(result).toHaveProperty('value')
      expect(result).toHaveProperty('status')
      expect(Array.isArray(result.value)).toBe(true)
      expect(['ok', 'needs_ocr']).toContain(result.status)
    })

    it('value is a valid PlateValue (passes Zod schema)', async () => {
      const path = writeTmpFixture('schema.txt', 'Hello world')
      const result = await extractDocument(path, 'text/plain')
      expect(() => plateValueSchema.parse(result.value)).not.toThrow()
    })
  })

  describe('text formats', () => {
    it('extracts plain text from .txt files', async () => {
      const path = writeTmpFixture('test.txt', 'Hello, world!')
      const result = await extractDocument(path, 'text/plain')
      expect(result.status).toBe('ok')
      expect(result.value.length).toBeGreaterThan(0)
      // Should contain text content
      const firstChild = result.value[0].children[0]
      expect('text' in firstChild && (firstChild as { text: string }).text).toContain('Hello')
    })

    it('extracts markdown from .md files preserving headings', async () => {
      const path = writeTmpFixture('test.md', '# Title\n\nSome content')
      const result = await extractDocument(path, 'text/markdown')
      expect(result.status).toBe('ok')
      // First block should be an h1
      expect(result.value[0].type).toBe('h1')
    })

    it('extracts CSV as paragraph content', async () => {
      const path = writeTmpFixture('test.csv', 'name,age\nAlice,30\nBob,25')
      const result = await extractDocument(path, 'text/csv')
      expect(result.status).toBe('ok')
      expect(result.value.length).toBeGreaterThan(0)
    })
  })

  describe('PDF extraction', () => {
    it('uses Gemini when API key is available', async () => {
      const originalKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key'

      const pdfPath = join(FIXTURES_DIR, 'fake-memo.pdf')
      const result = await extractDocument(pdfPath, 'application/pdf')
      expect(result.status).toBe('ok')
      expect(result.value.length).toBeGreaterThan(0)
      // Mock returns "# OCR Result\n\nOCR extracted text from Gemini"
      expect(result.value[0].type).toBe('h1')

      if (originalKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalKey
      else delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    })

    it('returns needs_ocr when no API key', async () => {
      const originalKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

      const pdfPath = join(FIXTURES_DIR, 'fake-memo.pdf')
      const result = await extractDocument(pdfPath, 'application/pdf')
      expect(result.status).toBe('needs_ocr')
      expect(result.warning).toBeDefined()

      if (originalKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalKey
    })
  })

  describe('DOCX extraction', () => {
    it('extracts content from a real DOCX fixture as Plate Value', async () => {
      const docxPath = join(FIXTURES_DIR, 'simple.docx')
      const result = await extractDocument(
        docxPath,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      )
      expect(result.status).toBe('ok')
      expect(result.value.length).toBeGreaterThan(0)
      expect(() => plateValueSchema.parse(result.value)).not.toThrow()
    })
  })

  describe('XLSX extraction', () => {
    it('builds Plate table nodes from real XLSX fixture', async () => {
      const xlsxPath = join(FIXTURES_DIR, 'stanley-cups.xlsx')
      const result = await extractDocument(
        xlsxPath,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      expect(result.status).toBe('ok')
      // Should contain a heading and a table
      const types = result.value.map((b) => b.type)
      expect(types).toContain('h2')
      expect(types).toContain('table')
      expect(() => plateValueSchema.parse(result.value)).not.toThrow()
    })

    it('uses TH cells for the header row', async () => {
      const xlsxPath = join(FIXTURES_DIR, 'stanley-cups.xlsx')
      const result = await extractDocument(
        xlsxPath,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      const table = result.value.find((b) => b.type === 'table')
      expect(table).toBeDefined()
      const firstRow = (table?.children as { type: string; children: unknown[] }[])[0]
      expect(firstRow.type).toBe('tr')
      const firstCell = (firstRow.children as { type: string }[])[0]
      expect(firstCell.type).toBe('th')
    })
  })

  describe('PPTX extraction', () => {
    it('extracts Plate Value from a real PPTX fixture', async () => {
      const originalKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

      const pptxPath = join(FIXTURES_DIR, 'simple.pptx')
      const result = await extractDocument(
        pptxPath,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      )
      expect(result.status).toBe('ok')
      expect(result.value.length).toBeGreaterThan(0)
      expect(() => plateValueSchema.parse(result.value)).not.toThrow()

      if (originalKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalKey
    })
  })

  describe('HTML extraction', () => {
    it('converts real HTML fixture to Plate Value', async () => {
      const htmlPath = join(FIXTURES_DIR, 'fake-html.html')
      const result = await extractDocument(htmlPath, 'text/html')
      expect(result.status).toBe('ok')
      expect(result.value.length).toBeGreaterThan(0)
      expect(() => plateValueSchema.parse(result.value)).not.toThrow()
    })

    it('converts headings and paragraphs from inline HTML', async () => {
      const html = '<h1>Title</h1><p>Paragraph</p><ul><li>Item 1</li><li>Item 2</li></ul>'
      const path = writeTmpFixture('test.html', html)
      const result = await extractDocument(path, 'text/html')
      expect(result.status).toBe('ok')
      const types = result.value.map((b) => b.type)
      expect(types).toContain('h1')
      expect(types).toContain('p')
      expect(types).toContain('ul')
    })

    it('parses HTML tables into Plate table nodes', async () => {
      const html =
        '<table><thead><tr><th>Name</th><th>Age</th></tr></thead>' +
        '<tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>'
      const path = writeTmpFixture('table.html', html)
      const result = await extractDocument(path, 'text/html')
      expect(result.status).toBe('ok')
      const table = result.value.find((b) => b.type === 'table')
      expect(table).toBeDefined()
    })
  })

  describe('image extraction', () => {
    it('returns needs_ocr when no API key is set', async () => {
      const originalKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY

      const imgPath = join(FIXTURES_DIR, 'document-screenshot.jpg')
      const result = await extractDocument(imgPath, 'image/jpeg')
      expect(result.status).toBe('needs_ocr')
      expect(result.warning).toContain('GOOGLE_GENERATIVE_AI_API_KEY')

      if (originalKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalKey
    })

    it('uses Gemini OCR when API key is set', async () => {
      const originalKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key'

      const imgPath = join(FIXTURES_DIR, 'document-screenshot.jpg')
      const result = await extractDocument(imgPath, 'image/jpeg')
      expect(result.status).toBe('ok')
      // Mock returns "# OCR Result\n\nOCR extracted text from Gemini"
      expect(result.value[0].type).toBe('h1')

      if (originalKey) process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalKey
      else delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    })
  })
})

// ---------------------------------------------------------------------------
// Round-trip integration tests: markdown → Plate → markdown → Plate → deep-equal
// ---------------------------------------------------------------------------

describe('round-trip serialization', () => {
  function roundTrip(md: string) {
    const plate1 = markdownToPlate(md)
    const md2 = plateToMarkdown(plate1)
    const plate2 = markdownToPlate(md2)
    return { plate1, md2, plate2 }
  }

  it('heading + paragraph round-trips to equal Plate Value', () => {
    const { plate1, plate2 } = roundTrip('# Title\n\nParagraph text.')
    expect(plate2).toEqual(plate1)
  })

  it('h1–h3 heading hierarchy round-trips', () => {
    const md = '# H1\n\n## H2\n\n### H3\n\nContent here.'
    const { plate1, plate2 } = roundTrip(md)
    expect(plate2).toEqual(plate1)
    expect(plate1[0].type).toBe('h1')
    expect(plate1[1].type).toBe('h2')
    expect(plate1[2].type).toBe('h3')
  })

  it('3-column table round-trips correctly', () => {
    const md = '| Name | Age | City |\n| --- | --- | --- |\n| Alice | 30 | SG |\n| Bob | 25 | KL |'
    const { plate1, plate2 } = roundTrip(md)
    expect(plate2).toEqual(plate1)
    const table = plate1.find((b) => b.type === 'table')
    expect(table).toBeDefined()
  })

  it('fenced code block preserves lang and content', () => {
    const md = '```typescript\nconst x = 1;\nconst y = 2;\n```'
    const { plate1, plate2 } = roundTrip(md)
    expect(plate2).toEqual(plate1)
    const codeBlock = plate1.find((b) => b.type === 'code_block')
    expect(codeBlock).toBeDefined()
    expect(codeBlock?.lang).toBe('typescript')
  })

  it('ordered and unordered lists round-trip', () => {
    const md = '- Item A\n- Item B\n- Item C\n\n1. First\n2. Second\n3. Third'
    const { plate1, plate2 } = roundTrip(md)
    expect(plate2).toEqual(plate1)
    expect(plate1[0].type).toBe('ul')
    expect(plate1[1].type).toBe('ol')
  })

  it('3-level nested list round-trips', () => {
    const md = '- Level 1\n  - Level 2\n    - Level 3\n  - Level 2b\n- Level 1b'
    const { plate1, plate2 } = roundTrip(md)
    expect(plate2).toEqual(plate1)
  })

  it('blockquote with inline formatting round-trips', () => {
    const md = '> This is **bold** and _italic_ text in a blockquote.'
    const { plate1, plate2 } = roundTrip(md)
    expect(plate2).toEqual(plate1)
    expect(plate1[0].type).toBe('blockquote')
  })

  it('horizontal rule round-trips', () => {
    const md = 'Before\n\n---\n\nAfter'
    const { plate1, plate2 } = roundTrip(md)
    expect(plate2).toEqual(plate1)
    const hr = plate1.find((b) => b.type === 'hr')
    expect(hr).toBeDefined()
  })

  it('inline code does not combine with bold/italic marks', () => {
    const md = 'Normal text with `inline code` and **bold**.'
    const plate = markdownToPlate(md)
    // Inline code nodes have code: true mark
    const para = plate[0]
    const codeChild = para.children.find((c) => 'code' in c && (c as { code?: boolean }).code === true)
    expect(codeChild).toBeDefined()
  })
})
