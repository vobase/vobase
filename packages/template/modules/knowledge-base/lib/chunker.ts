/**
 * Block-aware chunker operating on Plate Value (JSON AST).
 *
 * Chunking rules (in priority order):
 * 1. Tables → always own chunk. If >1000 tokens: split by ~50 row groups, repeat header row.
 * 2. Code blocks → always own chunk.
 * 3. Headings → start a new chunk (heading + following content).
 * 4. Paragraphs, blockquotes → accumulate until 512 token limit.
 * 5. Lists → accumulate with other content. If list alone exceeds limit: split at top-level item boundaries.
 * 6. Heading context prefix: each chunk carries last seen heading as prefix for embedding continuity.
 * 7. Token estimation: ~4 chars/token on serialized markdown.
 */

import { plateToMarkdown } from './plate-serialize';
import type { PlateElement, PlateText, PlateValue } from './plate-types';
import { NodeType } from './plate-types';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

interface ChunkOptions {
  maxTokens?: number; // Default: 512
}

interface BlockChunk {
  /** The Plate nodes in this chunk */
  blocks: PlateElement[];
  /** Markdown serialization (for embedding + FTS) */
  content: string;
  index: number;
  tokenCount: number;
  /** Start/end indices in the original Value array (inclusive) */
  blockRange: [number, number];
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Node type predicates
// ---------------------------------------------------------------------------

const HEADING_TYPES: ReadonlySet<string> = new Set([
  NodeType.H1,
  NodeType.H2,
  NodeType.H3,
  NodeType.H4,
  NodeType.H5,
  NodeType.H6,
]);

function isHeading(block: PlateElement): boolean {
  return HEADING_TYPES.has(block.type);
}

function isList(block: PlateElement): boolean {
  return block.type === NodeType.UL || block.type === NodeType.OL;
}

// ---------------------------------------------------------------------------
// Inline serializer (used for heading prefix and table serialization)
// Top-level block serialization uses plateToMarkdown() from './plate-serialize'.
// ---------------------------------------------------------------------------

function serializeInlineNode(node: PlateElement | PlateText): string {
  if ('text' in node) {
    // Cast needed: both PlateElement and PlateText have [key:string]:unknown index
    // signatures so narrowing via 'in' alone leaves node.text as unknown.
    const n = node as PlateText;
    let t = n.text;
    if (n.code) t = `\`${t}\``;
    if (n.bold) t = `**${t}**`;
    if (n.italic) t = `*${t}*`;
    if (n.strikethrough) t = `~~${t}~~`;
    return t;
  }
  const inner = (node.children as (PlateElement | PlateText)[])
    .map(serializeInlineNode)
    .join('');
  if (node.type === NodeType.A) return `[${inner}](${String(node.url ?? '')})`;
  return inner;
}

function serializeListItem(
  li: PlateElement,
  bullet: string,
  depth: number,
): string {
  const indent = '  '.repeat(depth);
  let textContent = '';
  const nestedParts: string[] = [];

  for (const child of li.children as (PlateElement | PlateText)[]) {
    if ('text' in child) {
      textContent += (child as PlateText).text;
    } else {
      const el = child as PlateElement;
      if (el.type === NodeType.LIC) {
        textContent = (el.children as (PlateElement | PlateText)[])
          .map(serializeInlineNode)
          .join('');
      } else if (el.type === NodeType.UL || el.type === NodeType.OL) {
        nestedParts.push(
          (el.children as PlateElement[])
            .map((item, idx) => {
              const nb = el.type === NodeType.OL ? `${idx + 1}.` : '-';
              return serializeListItem(item, nb, depth + 1);
            })
            .join('\n'),
        );
      }
    }
  }

  const line = `${indent}${bullet} ${textContent}`;
  return nestedParts.length > 0 ? `${line}\n${nestedParts.join('\n')}` : line;
}

function serializeTableNode(table: PlateElement): string {
  const rows = table.children as PlateElement[];
  if (rows.length === 0) return '';

  const lines: string[] = [];
  let headerInserted = false;

  for (const row of rows) {
    const cells = row.children as PlateElement[];
    const isHeaderRow = cells.some((c) => c.type === NodeType.TH);
    const cellTexts = cells.map((c) => {
      const children = c.children as (PlateElement | PlateText)[];
      return children
        .map((p) =>
          'text' in p
            ? serializeInlineNode(p)
            : (p as PlateElement).children.map(serializeInlineNode).join(''),
        )
        .join('');
    });
    lines.push(`| ${cellTexts.join(' | ')} |`);
    if (isHeaderRow && !headerInserted) {
      lines.push(`| ${cellTexts.map(() => '---').join(' | ')} |`);
      headerInserted = true;
    }
  }

  if (!headerInserted && lines.length > 0) {
    const firstRow = rows[0].children as PlateElement[];
    lines.splice(1, 0, `| ${firstRow.map(() => '---').join(' | ')} |`);
  }

  return lines.join('\n');
}

function serializeBlock(block: PlateElement, depth = 0): string {
  if (isHeading(block)) {
    const level = parseInt(block.type[1], 10);
    return `${'#'.repeat(level)} ${(block.children as (PlateElement | PlateText)[]).map(serializeInlineNode).join('')}`;
  }
  if (block.type === NodeType.P) {
    return (block.children as (PlateElement | PlateText)[])
      .map(serializeInlineNode)
      .join('');
  }
  if (block.type === NodeType.BLOCKQUOTE) {
    return (block.children as (PlateElement | PlateText)[])
      .map(
        (c) =>
          `> ${'text' in c ? (c as PlateText).text : serializeBlock(c as PlateElement)}`,
      )
      .join('\n');
  }
  if (block.type === NodeType.CODE_BLOCK) {
    const lang = String(block.lang ?? '');
    const lines = (block.children as PlateElement[]).map((line) =>
      (line.children as PlateText[]).map((t) => t.text).join(''),
    );
    return `\`\`\`${lang}\n${lines.join('\n')}\n\`\`\``;
  }
  if (block.type === NodeType.HR) return '---';
  if (block.type === NodeType.IMG) {
    return `![${String(block.alt ?? '')}](${String(block.url ?? '')})`;
  }
  if (block.type === NodeType.UL || block.type === NodeType.OL) {
    return (block.children as PlateElement[])
      .map((item, idx) => {
        const bullet = block.type === NodeType.OL ? `${idx + 1}.` : '-';
        return serializeListItem(item, bullet, depth);
      })
      .join('\n');
  }
  if (block.type === NodeType.TABLE) return serializeTableNode(block);
  // Fallback: concatenate children
  return (block.children as (PlateElement | PlateText)[])
    .map((c) =>
      'text' in c
        ? (c as PlateText).text
        : serializeBlock(c as PlateElement, depth),
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Table splitting (for tables > TABLE_TOKEN_THRESHOLD tokens)
// ---------------------------------------------------------------------------

const TABLE_TOKEN_THRESHOLD = 1000;
const ROW_GROUP_SIZE = 50;

function getHeaderRows(rows: PlateElement[]): PlateElement[] {
  return rows.filter((row) =>
    (row.children as PlateElement[]).some((c) => c.type === NodeType.TH),
  );
}

function splitLargeTable(
  table: PlateElement,
  tableIndex: number,
  headingPrefix: string,
  startChunkIndex: number,
): BlockChunk[] {
  const rows = table.children as PlateElement[];
  let headerRows = getHeaderRows(rows);
  let dataRows = rows.filter((r) => !headerRows.includes(r));

  // If no header rows found, treat first row as header
  if (headerRows.length === 0 && rows.length > 0) {
    headerRows = [rows[0]];
    dataRows = rows.slice(1);
  }

  if (dataRows.length === 0) {
    const raw = serializeTableNode(table);
    const content = headingPrefix ? `${headingPrefix}\n\n${raw}` : raw;
    return [
      {
        blocks: [table],
        content,
        index: startChunkIndex,
        tokenCount: estimateTokens(content),
        blockRange: [tableIndex, tableIndex],
      },
    ];
  }

  const chunks: BlockChunk[] = [];
  for (let i = 0; i < dataRows.length; i += ROW_GROUP_SIZE) {
    const group = dataRows.slice(i, i + ROW_GROUP_SIZE);
    const groupTable: PlateElement = {
      ...table,
      children: [...headerRows, ...group],
    };
    const raw = serializeTableNode(groupTable);
    const content = headingPrefix ? `${headingPrefix}\n\n${raw}` : raw;
    chunks.push({
      blocks: [groupTable],
      content,
      index: startChunkIndex + chunks.length,
      tokenCount: estimateTokens(content),
      blockRange: [tableIndex, tableIndex],
    });
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// List splitting (for lists that alone exceed maxTokens)
// ---------------------------------------------------------------------------

function splitLargeList(
  list: PlateElement,
  listIndex: number,
  headingPrefix: string,
  maxTokens: number,
  startChunkIndex: number,
): BlockChunk[] {
  const items = list.children as PlateElement[];
  const chunks: BlockChunk[] = [];
  let currentItems: PlateElement[] = [];

  const flushItems = () => {
    if (currentItems.length === 0) return;
    const subList: PlateElement = { ...list, children: currentItems };
    const raw = plateToMarkdown([subList]);
    const content = headingPrefix ? `${headingPrefix}\n\n${raw}` : raw;
    chunks.push({
      blocks: [subList],
      content,
      index: startChunkIndex + chunks.length,
      tokenCount: estimateTokens(content),
      blockRange: [listIndex, listIndex],
    });
    currentItems = [];
  };

  for (const item of items) {
    const testList: PlateElement = {
      ...list,
      children: [...currentItems, item],
    };
    const testRaw = plateToMarkdown([testList]);
    const testContent = headingPrefix
      ? `${headingPrefix}\n\n${testRaw}`
      : testRaw;
    if (estimateTokens(testContent) > maxTokens && currentItems.length > 0) {
      flushItems();
    }
    currentItems.push(item);
  }
  flushItems();

  return chunks;
}

// ---------------------------------------------------------------------------
// Main: blockChunk()
// ---------------------------------------------------------------------------

/**
 * Chunk a Plate Value into semantically coherent BlockChunks.
 * Respects block boundaries — tables and code blocks are never split across chunks.
 */
export function blockChunk(
  value: PlateValue,
  options?: ChunkOptions,
): BlockChunk[] {
  const maxTokens = options?.maxTokens ?? 512;

  const result: BlockChunk[] = [];
  let currentBlocks: PlateElement[] = [];
  let currentStartIndex = 0;
  let lastHeading: PlateElement | null = null;

  /** Return heading prefix for a chunk whose first block is not a heading. */
  const getHeadingPrefix = (firstBlock: PlateElement): string => {
    if (!lastHeading || isHeading(firstBlock)) return '';
    return serializeBlock(lastHeading);
  };

  /** Flush accumulated currentBlocks as a chunk ending at endIndex (inclusive). */
  const flushCurrent = (endIndex: number) => {
    if (currentBlocks.length === 0) return;
    const prefix = getHeadingPrefix(currentBlocks[0]);
    const raw = plateToMarkdown(currentBlocks);
    const content = prefix ? `${prefix}\n\n${raw}` : raw;
    result.push({
      blocks: [...currentBlocks],
      content,
      index: result.length,
      tokenCount: estimateTokens(content),
      blockRange: [currentStartIndex, endIndex],
    });
    currentBlocks = [];
    currentStartIndex = endIndex + 1;
  };

  for (let i = 0; i < value.length; i++) {
    const block = value[i];

    // --- Tables: always own chunk ---
    if (block.type === NodeType.TABLE) {
      flushCurrent(i - 1);
      const prefix = lastHeading ? serializeBlock(lastHeading) : '';
      const raw = serializeTableNode(block);
      const content = prefix ? `${prefix}\n\n${raw}` : raw;
      const tokens = estimateTokens(content);

      if (tokens > TABLE_TOKEN_THRESHOLD) {
        const tableChunks = splitLargeTable(block, i, prefix, result.length);
        result.push(...tableChunks);
      } else {
        result.push({
          blocks: [block],
          content,
          index: result.length,
          tokenCount: tokens,
          blockRange: [i, i],
        });
      }
      currentStartIndex = i + 1;
      continue;
    }

    // --- Code blocks: always own chunk ---
    if (block.type === NodeType.CODE_BLOCK) {
      flushCurrent(i - 1);
      const prefix = lastHeading ? serializeBlock(lastHeading) : '';
      const raw = serializeBlock(block);
      const content = prefix ? `${prefix}\n\n${raw}` : raw;
      result.push({
        blocks: [block],
        content,
        index: result.length,
        tokenCount: estimateTokens(content),
        blockRange: [i, i],
      });
      currentStartIndex = i + 1;
      continue;
    }

    // --- Headings: start a new chunk ---
    if (isHeading(block)) {
      flushCurrent(i - 1);
      lastHeading = block;
      currentBlocks = [block];
      currentStartIndex = i;
      continue;
    }

    // --- Lists: accumulate; split if alone exceeds limit ---
    if (isList(block)) {
      const headingPfx = lastHeading ? serializeBlock(lastHeading) : '';

      if (currentBlocks.length > 0) {
        const candidateRaw = plateToMarkdown([...currentBlocks, block]);
        const candidatePrefix = getHeadingPrefix(currentBlocks[0]);
        const candidateContent = candidatePrefix
          ? `${candidatePrefix}\n\n${candidateRaw}`
          : candidateRaw;

        if (estimateTokens(candidateContent) > maxTokens) {
          flushCurrent(i - 1);
          const listRaw = plateToMarkdown([block]);
          const listContent = headingPfx
            ? `${headingPfx}\n\n${listRaw}`
            : listRaw;
          if (estimateTokens(listContent) > maxTokens) {
            const splitChunks = splitLargeList(
              block,
              i,
              headingPfx,
              maxTokens,
              result.length,
            );
            result.push(...splitChunks);
            currentStartIndex = i + 1;
          } else {
            currentBlocks = [block];
          }
        } else {
          currentBlocks.push(block);
        }
      } else {
        const listRaw = plateToMarkdown([block]);
        const listContent = headingPfx
          ? `${headingPfx}\n\n${listRaw}`
          : listRaw;
        if (estimateTokens(listContent) > maxTokens) {
          const splitChunks = splitLargeList(
            block,
            i,
            headingPfx,
            maxTokens,
            result.length,
          );
          result.push(...splitChunks);
          currentStartIndex = i + 1;
        } else {
          currentBlocks = [block];
        }
      }
      continue;
    }

    // --- Paragraphs, blockquotes, other: accumulate ---
    if (currentBlocks.length > 0) {
      const candidateRaw = plateToMarkdown([...currentBlocks, block]);
      const prefix = getHeadingPrefix(currentBlocks[0]);
      const candidateContent = prefix
        ? `${prefix}\n\n${candidateRaw}`
        : candidateRaw;
      if (estimateTokens(candidateContent) > maxTokens) {
        flushCurrent(i - 1);
        currentBlocks = [block];
      } else {
        currentBlocks.push(block);
      }
    } else {
      currentBlocks = [block];
    }
  }

  // Flush any remaining blocks
  flushCurrent(value.length - 1);

  return result;
}
