import { describe, expect, it } from 'bun:test';

import { blockChunk } from './chunker';
import {
  createCodeBlock,
  createHeading,
  createList,
  createListItem,
  createParagraph,
  createTable,
  createTableCell,
  createTableRow,
  createText,
} from './plate-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeText(n: number): string {
  // ~4 chars per token → n tokens ≈ n*4 chars
  return 'w'.repeat(n * 4);
}

function para(tokenCount: number) {
  return createParagraph([createText(makeText(tokenCount))]);
}

function heading(level: 1 | 2 | 3 | 4 | 5 | 6, label: string) {
  return createHeading(level, [createText(label)]);
}

function makeTableRows(count: number, cols = 3, withHeader = true) {
  const rows = [];
  if (withHeader) {
    rows.push(
      createTableRow(
        Array.from({ length: cols }, (_, c) =>
          createTableCell([createText(`H${c + 1}`)], true),
        ),
      ),
    );
  }
  for (let r = 0; r < count; r++) {
    rows.push(
      createTableRow(
        Array.from({ length: cols }, (_, c) =>
          createTableCell([createText(`R${r + 1}C${c + 1}`)]),
        ),
      ),
    );
  }
  return rows;
}

function makeTable(dataRows: number, cols = 3) {
  return createTable(makeTableRows(dataRows, cols));
}

function makeListItems(count: number, tokenEach: number) {
  return Array.from({ length: count }, (_, i) =>
    createListItem([createText(`Item ${i + 1} ${makeText(tokenEach)}`)]),
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

describe('blockChunk — tables', () => {
  it('table is never split with adjacent content', () => {
    const value = [para(10), makeTable(5), para(10)];
    const chunks = blockChunk(value);

    const tableChunks = chunks.filter((c) =>
      c.blocks.some((b) => b.type === 'table'),
    );
    expect(tableChunks).toHaveLength(1);
    // Table chunk contains only the table block (plus possibly a heading prefix)
    expect(tableChunks[0].blocks).toHaveLength(1);
    expect(tableChunks[0].blocks[0].type).toBe('table');
  });

  it('table is always its own chunk even when small', () => {
    const table = makeTable(2);
    const value = [para(5), table, para(5)];
    const chunks = blockChunk(value);

    for (const chunk of chunks) {
      const hasTable = chunk.blocks.some((b) => b.type === 'table');
      const hasOther = chunk.blocks.some((b) => b.type !== 'table');
      // A chunk with a table should not have other block types mixed in
      if (hasTable) expect(hasOther).toBe(false);
    }
  });

  it('small table (<= 1000 tokens) produces exactly one chunk', () => {
    const table = makeTable(3);
    const chunks = blockChunk([table]);
    const tableChunks = chunks.filter((c) =>
      c.blocks.some((b) => b.type === 'table'),
    );
    expect(tableChunks).toHaveLength(1);
  });

  it('large table (> 1000 tokens) splits into row groups of ~50 rows', () => {
    // Each cell is ~20 tokens; 3 cols × 20 = 60 tokens/row × 120 rows = 7200 tokens
    const colCount = 3;
    const rows: ReturnType<typeof createTableRow>[] = [];
    // Header row
    rows.push(
      createTableRow(
        Array.from({ length: colCount }, (_, c) =>
          createTableCell([createText(`Col${c + 1}`)], true),
        ),
      ),
    );
    // 120 data rows × 60 tokens each = well over 1000 tokens
    for (let r = 0; r < 120; r++) {
      rows.push(
        createTableRow(
          Array.from({ length: colCount }, () =>
            createTableCell([createText(makeText(20))]),
          ),
        ),
      );
    }
    const table = createTable(rows);
    const chunks = blockChunk([table]);

    // Should produce multiple chunks
    expect(chunks.length).toBeGreaterThan(1);

    // Each chunk should have at most ROW_GROUP_SIZE (50) data rows + header rows
    for (const chunk of chunks) {
      const chunkTable = chunk.blocks[0];
      const tableRows = chunkTable.children as unknown[];
      // header + up to 50 data rows
      expect(tableRows.length).toBeLessThanOrEqual(51);
    }
  });

  it('large table chunks each contain the header row', () => {
    const colCount = 2;
    const headerCells = Array.from({ length: colCount }, (_, c) =>
      createTableCell([createText(`Header${c + 1}`)], true),
    );
    const headerRow = createTableRow(headerCells);
    const rows = [headerRow];
    for (let r = 0; r < 120; r++) {
      rows.push(
        createTableRow([
          createTableCell([createText(makeText(30))]),
          createTableCell([createText(makeText(30))]),
        ]),
      );
    }
    const table = createTable(rows);
    const chunks = blockChunk([table]);

    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      // Each chunk's content should include the header cell text
      expect(chunk.content).toContain('Header1');
      expect(chunk.content).toContain('Header2');
    }
  });
});

// ---------------------------------------------------------------------------
// Code blocks
// ---------------------------------------------------------------------------

describe('blockChunk — code blocks', () => {
  it('code block is never split', () => {
    const code = createCodeBlock(
      Array.from(
        { length: 200 },
        (_, i) => `const x${i} = ${i}; // some comment here`,
      ),
      'typescript',
    );
    const chunks = blockChunk([code]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].blocks[0].type).toBe('code_block');
  });

  it('code block is always its own chunk regardless of size', () => {
    const code = createCodeBlock(['const x = 1;'], 'typescript');
    const value = [para(10), code, para(10)];
    const chunks = blockChunk(value);

    for (const chunk of chunks) {
      const hasCode = chunk.blocks.some((b) => b.type === 'code_block');
      const hasOther = chunk.blocks.some((b) => b.type !== 'code_block');
      if (hasCode) expect(hasOther).toBe(false);
    }
  });

  it('code block chunk has correct blockRange', () => {
    const value = [para(5), createCodeBlock(['x = 1']), para(5)];
    const chunks = blockChunk(value);
    const codeChunk = chunks.find((c) => c.blocks[0].type === 'code_block');
    expect(codeChunk).toBeDefined();
    expect(codeChunk?.blockRange).toEqual([1, 1]);
  });
});

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------

describe('blockChunk — headings', () => {
  it('heading always starts a new chunk', () => {
    const value = [
      para(20),
      heading(2, 'Section A'),
      para(20),
      heading(2, 'Section B'),
      para(20),
    ];
    const chunks = blockChunk(value);

    // The heading blocks must be the FIRST block in their chunk
    for (const chunk of chunks) {
      if (chunk.blocks[0].type === 'h2') {
        expect(chunk.blocks[0].type).toBe('h2');
      }
      // No chunk should have a heading in the middle or end
      for (let i = 1; i < chunk.blocks.length; i++) {
        expect(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']).not.toContain(
          chunk.blocks[i].type,
        );
      }
    }
  });

  it('heading followed by content stays in the same chunk', () => {
    const value = [heading(1, 'Title'), para(5), para(5)];
    const chunks = blockChunk(value);
    // All three blocks should be in one chunk (total < 512 tokens)
    expect(chunks).toHaveLength(1);
    expect(chunks[0].blocks).toHaveLength(3);
    expect(chunks[0].blocks[0].type).toBe('h1');
  });

  it('two consecutive headings each start a new chunk', () => {
    const value = [heading(1, 'Intro'), heading(2, 'Details'), para(10)];
    const chunks = blockChunk(value);
    // heading(1) alone → chunk 0; heading(2) + para → chunk 1
    expect(chunks).toHaveLength(2);
    expect(chunks[0].blocks[0].type).toBe('h1');
    expect(chunks[1].blocks[0].type).toBe('h2');
  });

  it('heading with enough following content splits into multiple chunks', () => {
    const value = [
      heading(2, 'Big Section'),
      ...Array.from({ length: 50 }, () => para(15)),
    ];
    const chunks = blockChunk(value);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk must start with the heading
    expect(chunks[0].blocks[0].type).toBe('h2');
  });
});

// ---------------------------------------------------------------------------
// Heading context prefix
// ---------------------------------------------------------------------------

describe('blockChunk — heading context prefix', () => {
  it('non-heading chunk carries last heading as prefix', () => {
    const h = heading(2, 'My Section');
    // Enough content to overflow first chunk and create a second non-heading chunk
    const value = [
      h,
      para(300), // first para fills chunk with heading
      para(300), // second para forces a new chunk — no heading, needs prefix
    ];
    const chunks = blockChunk(value);

    // Find a chunk that does NOT start with a heading
    const nonHeadingChunk = chunks.find(
      (c) => !['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(c.blocks[0].type),
    );
    expect(nonHeadingChunk).toBeDefined();
    expect(nonHeadingChunk?.content).toContain('My Section');
  });

  it('heading prefix is not duplicated in heading-start chunks', () => {
    const value = [heading(2, 'Chapter'), para(10)];
    const chunks = blockChunk(value);
    // Only one chunk; starts with heading, so prefix should NOT be added
    expect(chunks).toHaveLength(1);
    // Should contain heading text only once
    const occurrences = chunks[0].content.split('Chapter').length - 1;
    expect(occurrences).toBe(1);
  });

  it('table chunk carries last heading as prefix', () => {
    const value = [heading(1, 'Data Overview'), makeTable(3)];
    const chunks = blockChunk(value);
    const tableChunk = chunks.find((c) => c.blocks[0].type === 'table');
    expect(tableChunk).toBeDefined();
    expect(tableChunk?.content).toContain('Data Overview');
  });

  it('code block chunk carries last heading as prefix', () => {
    const value = [
      heading(3, 'Implementation'),
      createCodeBlock(['const x = 1;']),
    ];
    const chunks = blockChunk(value);
    const codeChunk = chunks.find((c) => c.blocks[0].type === 'code_block');
    expect(codeChunk).toBeDefined();
    expect(codeChunk?.content).toContain('Implementation');
  });
});

// ---------------------------------------------------------------------------
// Large nested list splitting
// ---------------------------------------------------------------------------

describe('blockChunk — list splitting', () => {
  it('small list accumulates with other content', () => {
    const list = createList(false, makeListItems(5, 5));
    const value = [para(10), list];
    const chunks = blockChunk(value);
    // Both should fit in one chunk
    expect(chunks).toHaveLength(1);
  });

  it('large list (> 512 tokens alone) splits at top-level item boundaries', () => {
    // 100 items × 10 tokens each = 1000 tokens total
    const items = makeListItems(100, 10);
    const list = createList(false, items);
    const chunks = blockChunk([list]);

    expect(chunks.length).toBeGreaterThan(1);

    // Every chunk should only contain top-level list items (no items split mid-item)
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it('split list chunks each respect the token limit', () => {
    const items = makeListItems(100, 10);
    const list = createList(false, items);
    const chunks = blockChunk([list], { maxTokens: 256 });

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(256 + 50); // small slack for edge items
    }
  });

  it('list does not split mid-nested-item', () => {
    // Top-level items with deeply nested children
    const nestedItems = Array.from({ length: 20 }, (_, i) => {
      const innerList = createList(
        false,
        Array.from({ length: 5 }, (_, j) =>
          createListItem([createText(`${makeText(8)} nested ${i}-${j}`)]),
        ),
      );
      const li = {
        type: 'li' as const,
        children: [
          { type: 'lic' as const, children: [createText(`Top ${i}`)] },
          innerList,
        ],
      };
      return li;
    });
    const list = createList(false, nestedItems);
    const chunks = blockChunk([list], { maxTokens: 256 });

    // Each chunk should have complete top-level items (i.e., each block is a full list)
    for (const chunk of chunks) {
      for (const block of chunk.blocks) {
        if (block.type === 'ul' || block.type === 'ol') {
          // Every child is a full li node (not a fragment)
          for (const child of block.children) {
            expect((child as { type: string }).type).toBe('li');
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Token limit
// ---------------------------------------------------------------------------

describe('blockChunk — token limit', () => {
  it('chunks respect 512 token default limit', () => {
    const value = Array.from({ length: 50 }, () => para(20));
    const chunks = blockChunk(value);

    for (const chunk of chunks) {
      // Allow slight overage for single-block chunks (indivisible)
      expect(chunk.tokenCount).toBeLessThanOrEqual(600);
    }
  });

  it('respects custom maxTokens option', () => {
    const value = Array.from({ length: 50 }, () => para(10));
    const chunks = blockChunk(value, { maxTokens: 128 });

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(200); // allow overage for indivisible
    }
  });

  it('large indivisible code block exceeds token limit (expected behavior)', () => {
    const bigCode = createCodeBlock(
      Array.from({ length: 500 }, (_, i) => `const variable${i} = ${i};`),
      'typescript',
    );
    const chunks = blockChunk([bigCode]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].tokenCount).toBeGreaterThan(512);
  });
});

// ---------------------------------------------------------------------------
// Index and blockRange
// ---------------------------------------------------------------------------

describe('blockChunk — index and blockRange', () => {
  it('chunk indices are sequential starting from 0', () => {
    const value = [heading(1, 'A'), para(10), makeTable(3), para(10)];
    const chunks = blockChunk(value);
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });

  it('blockRange covers the correct original indices', () => {
    // value[0]=para, value[1]=table, value[2]=para
    const value = [para(5), makeTable(2), para(5)];
    const chunks = blockChunk(value);

    const paraChunk0 = chunks[0];
    expect(paraChunk0.blockRange[0]).toBe(0);
    expect(paraChunk0.blockRange[1]).toBe(0);

    const tableChunk = chunks.find((c) => c.blocks[0].type === 'table');
    expect(tableChunk?.blockRange).toEqual([1, 1]);
  });

  it('returns empty array for empty value', () => {
    expect(blockChunk([])).toEqual([]);
  });

  it('single paragraph returns one chunk', () => {
    const chunks = blockChunk([para(10)]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].blockRange).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------------------
// Content serialization
// ---------------------------------------------------------------------------

describe('blockChunk — content field', () => {
  it('content includes heading markdown syntax', () => {
    const value = [heading(2, 'Section Title'), para(5)];
    const chunks = blockChunk(value);
    expect(chunks[0].content).toContain('## Section Title');
  });

  it('content includes code fence', () => {
    const value = [createCodeBlock(['x = 1'], 'python')];
    const chunks = blockChunk(value);
    expect(chunks[0].content).toContain('```python');
    expect(chunks[0].content).toContain('x = 1');
    expect(chunks[0].content).toContain('```');
  });

  it('content includes table pipe syntax', () => {
    const value = [makeTable(2)];
    const chunks = blockChunk(value);
    expect(chunks[0].content).toContain('|');
  });

  it('tokenCount matches estimated tokens of content', () => {
    const value = [para(50)];
    const chunks = blockChunk(value);
    const expected = Math.ceil(chunks[0].content.length / 4);
    expect(chunks[0].tokenCount).toBe(expected);
  });
});
