/**
 * Server-side deserialization: markdown/HTML → Plate Value.
 *
 * IMPORTANT: Server-side only. NO React, NO @platejs/* imports.
 * Uses unified + remark-parse + rehype-parse exclusively.
 */
import rehypeParse from 'rehype-parse';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import {
  createBlockquote,
  createCodeBlock,
  createHeading,
  createHr,
  createImage,
  createLink,
  createList,
  createParagraph,
  createTable,
  createTableCell,
  createTableRow,
  createText,
  NodeType,
  type PlateElement,
  type PlateText,
  type PlateValue,
} from './plate-types';

// ---------------------------------------------------------------------------
// Local mdast type aliases (avoids direct mdast package import)
// ---------------------------------------------------------------------------

interface MdNode {
  type: string;
  [key: string]: unknown;
}
interface MdRoot {
  type: 'root';
  children: MdNode[];
}
interface MdHeading {
  type: 'heading';
  depth: number;
  children: MdNode[];
}
interface MdParagraph {
  type: 'paragraph';
  children: MdNode[];
}
interface MdBlockquote {
  type: 'blockquote';
  children: MdNode[];
}
interface MdCode {
  type: 'code';
  value: string;
  lang?: string | null;
}
interface MdList {
  type: 'list';
  ordered: boolean;
  children: MdListItem[];
}
interface MdListItem {
  type: 'listItem';
  children: MdNode[];
}
interface MdTable {
  type: 'table';
  children: MdTableRow[];
}
interface MdTableRow {
  type: 'tableRow';
  children: MdTableCell[];
}
interface MdTableCell {
  type: 'tableCell';
  children: MdNode[];
}
interface MdText {
  type: 'text';
  value: string;
}
interface MdEmphasis {
  type: 'emphasis';
  children: MdNode[];
}
interface MdStrong {
  type: 'strong';
  children: MdNode[];
}
interface MdDelete {
  type: 'delete';
  children: MdNode[];
}
interface MdInlineCode {
  type: 'inlineCode';
  value: string;
}
interface MdLink {
  type: 'link';
  url: string;
  children: MdNode[];
}
interface MdImage {
  type: 'image';
  url: string;
  alt?: string;
}
interface MdHtml {
  type: 'html';
  value: string;
}

// ---------------------------------------------------------------------------
// Local hast type aliases
// ---------------------------------------------------------------------------

interface HastText {
  type: 'text';
  value: string;
}
interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, unknown>;
  children: HastChild[];
}
interface HastRoot {
  type: 'root';
  children: HastChild[];
}
type HastChild =
  | HastText
  | HastElement
  | { type: string; [key: string]: unknown };

// ---------------------------------------------------------------------------
// Markdown → Plate Value
// ---------------------------------------------------------------------------

export function markdownToPlate(md: string): PlateValue {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .parse(md) as unknown as MdRoot;
  const blocks = tree.children
    .flatMap(mdBlockToPlate)
    .filter((b): b is PlateElement => b !== null);
  return blocks.length > 0 ? blocks : [createParagraph()];
}

type InlineMarks = {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
};

function mdInlineToPlate(
  node: MdNode,
  marks: InlineMarks = {},
): (PlateText | PlateElement)[] {
  switch (node.type) {
    case 'text':
      return [createText((node as unknown as MdText).value, marks)];
    case 'inlineCode':
      return [
        createText((node as unknown as MdInlineCode).value, {
          ...marks,
          code: true,
        }),
      ];
    case 'emphasis':
      return (node as unknown as MdEmphasis).children.flatMap((n) =>
        mdInlineToPlate(n, { ...marks, italic: true }),
      );
    case 'strong':
      return (node as unknown as MdStrong).children.flatMap((n) =>
        mdInlineToPlate(n, { ...marks, bold: true }),
      );
    case 'delete':
      return (node as unknown as MdDelete).children.flatMap((n) =>
        mdInlineToPlate(n, { ...marks, strikethrough: true }),
      );
    case 'link': {
      const link = node as unknown as MdLink;
      const children = link.children.flatMap((n) => mdInlineToPlate(n, marks));
      return [
        createLink(
          link.url,
          children.length > 0 ? children : [createText(link.url)],
        ),
      ];
    }
    case 'image': {
      const img = node as unknown as MdImage;
      return [createImage(img.url, img.alt)];
    }
    case 'break':
      return [createText('\n')];
    case 'html':
      return [createText((node as unknown as MdHtml).value)];
    default:
      return [];
  }
}

function mdInlinesToPlate(children: MdNode[]): (PlateText | PlateElement)[] {
  const result = children.flatMap((n) => mdInlineToPlate(n));
  return result.length > 0 ? result : [createText('')];
}

function mdBlockToPlate(node: MdNode): PlateElement[] {
  switch (node.type) {
    case 'heading': {
      const h = node as unknown as MdHeading;
      return [
        createHeading(
          h.depth as 1 | 2 | 3 | 4 | 5 | 6,
          mdInlinesToPlate(h.children),
        ),
      ];
    }
    case 'paragraph':
      return [
        createParagraph(
          mdInlinesToPlate((node as unknown as MdParagraph).children),
        ),
      ];
    case 'blockquote': {
      const bq = node as unknown as MdBlockquote;
      const inlineChildren: (PlateElement | PlateText)[] = bq.children.flatMap(
        (child) => {
          if (child.type === 'paragraph') {
            return mdInlinesToPlate((child as unknown as MdParagraph).children);
          }
          return [createText('')];
        },
      );
      return [
        createBlockquote(
          inlineChildren.length > 0 ? inlineChildren : [createText('')],
        ),
      ];
    }
    case 'code': {
      const c = node as unknown as MdCode;
      return [
        createCodeBlock((c.value ?? '').split('\n'), c.lang ?? undefined),
      ];
    }
    case 'list':
      return [mdListToPlate(node as unknown as MdList)];
    case 'table':
      return [mdTableToPlate(node as unknown as MdTable)];
    case 'thematicBreak':
      return [createHr()];
    case 'html':
      return [createParagraph([createText((node as unknown as MdHtml).value)])];
    default:
      return [];
  }
}

function mdListToPlate(node: MdList): PlateElement {
  const items = node.children.map(mdListItemToPlate);
  return createList(node.ordered, items);
}

function mdListItemToPlate(node: MdListItem): PlateElement {
  let licChildren: (PlateElement | PlateText)[] = [createText('')];
  const nestedLists: PlateElement[] = [];

  for (const child of node.children) {
    if (child.type === 'paragraph') {
      licChildren = mdInlinesToPlate(
        (child as unknown as MdParagraph).children,
      );
    } else if (child.type === 'list') {
      nestedLists.push(mdListToPlate(child as unknown as MdList));
    }
  }

  const lic: PlateElement = { type: NodeType.LIC, children: licChildren };
  return { type: NodeType.LI, children: [lic, ...nestedLists] };
}

function mdTableToPlate(node: MdTable): PlateElement {
  const rows: PlateElement[] = node.children.map((row, rowIndex) => {
    const isHeader = rowIndex === 0;
    const cells = row.children.map((cell) =>
      createTableCell(mdInlinesToPlate(cell.children), isHeader),
    );
    return createTableRow(cells);
  });
  return createTable(rows);
}

// ---------------------------------------------------------------------------
// HTML → Plate Value
// ---------------------------------------------------------------------------

export function htmlToPlate(html: string): PlateValue {
  const tree = unified()
    .use(rehypeParse, { fragment: true })
    .parse(html) as unknown as HastRoot;
  const blocks = tree.children.flatMap(hastNodeToBlocks);
  return blocks.length > 0 ? blocks : [createParagraph()];
}

function hastNodeToBlocks(child: HastChild): PlateElement[] {
  if (child.type === 'text') {
    const text = (child as HastText).value.trim();
    if (text) return [createParagraph([createText(text)])];
    return [];
  }
  if (child.type !== 'element') return [];
  return hastElementToBlocks(child as HastElement);
}

function hastElementToBlocks(el: HastElement): PlateElement[] {
  const tag = el.tagName;

  // Headings h1–h6
  const headingMatch = tag.match(/^h([1-6])$/);
  if (headingMatch) {
    const level = parseInt(headingMatch[1], 10) as 1 | 2 | 3 | 4 | 5 | 6;
    return [createHeading(level, hastInlinesToPlate(el.children))];
  }

  // Paragraph
  if (tag === 'p') return [createParagraph(hastInlinesToPlate(el.children))];

  // Blockquote
  if (tag === 'blockquote') {
    const inlineChildren: (PlateElement | PlateText)[] = [];
    for (const child of el.children) {
      if (child.type === 'element' && (child as HastElement).tagName === 'p') {
        inlineChildren.push(
          ...hastInlinesToPlate((child as HastElement).children),
        );
      } else if (child.type === 'text') {
        const text = (child as HastText).value.trim();
        if (text) inlineChildren.push(createText(text));
      } else if (child.type === 'element') {
        inlineChildren.push(...hastInlinesToPlate([child]));
      }
    }
    return [
      createBlockquote(
        inlineChildren.length > 0 ? inlineChildren : [createText('')],
      ),
    ];
  }

  // Code block: pre > code
  if (tag === 'pre') {
    const codeEl = el.children.find(
      (c): c is HastElement =>
        c.type === 'element' && (c as HastElement).tagName === 'code',
    );
    const lang = codeEl ? hastExtractLang(codeEl) : undefined;
    const codeText = hastExtractText(codeEl ?? el);
    // Strip trailing newline that browsers typically add
    const cleaned = codeText.endsWith('\n') ? codeText.slice(0, -1) : codeText;
    return [createCodeBlock(cleaned.split('\n'), lang)];
  }

  // Lists
  if (tag === 'ul') return [hastListToPlate(el, false)];
  if (tag === 'ol') return [hastListToPlate(el, true)];

  // Table
  if (tag === 'table') return [hastTableToPlate(el)];

  // HR
  if (tag === 'hr') return [createHr()];

  // Container elements — recurse into children
  const containers = [
    'div',
    'section',
    'article',
    'main',
    'header',
    'footer',
    'nav',
    'aside',
    'body',
    'html',
  ];
  if (containers.includes(tag)) {
    return el.children.flatMap(hastNodeToBlocks);
  }

  // Inline elements at block level — wrap in paragraph
  const inlines = hastInlinesToPlate([el]);
  if (inlines.length > 0) return [createParagraph(inlines)];
  return [];
}

function hastListToPlate(el: HastElement, ordered: boolean): PlateElement {
  const items = el.children
    .filter(
      (c): c is HastElement =>
        c.type === 'element' && (c as HastElement).tagName === 'li',
    )
    .map(hastListItemToPlate);
  return createList(ordered, items);
}

function hastListItemToPlate(el: HastElement): PlateElement {
  const licChildren: (PlateElement | PlateText)[] = [];
  const nestedLists: PlateElement[] = [];

  for (const child of el.children) {
    if (child.type === 'element') {
      const childEl = child as HastElement;
      if (childEl.tagName === 'ul') {
        nestedLists.push(hastListToPlate(childEl, false));
      } else if (childEl.tagName === 'ol') {
        nestedLists.push(hastListToPlate(childEl, true));
      } else if (childEl.tagName === 'p') {
        licChildren.push(...hastInlinesToPlate(childEl.children));
      } else {
        licChildren.push(...hastInlinesToPlate([childEl]));
      }
    } else if (child.type === 'text') {
      const text = (child as HastText).value;
      if (text.trim()) licChildren.push(createText(text));
    }
  }

  const lic: PlateElement = {
    type: NodeType.LIC,
    children: licChildren.length > 0 ? licChildren : [createText('')],
  };
  return { type: NodeType.LI, children: [lic, ...nestedLists] };
}

function hastTableToPlate(el: HastElement): PlateElement {
  const rows: PlateElement[] = [];

  for (const child of el.children) {
    if (child.type !== 'element') continue;
    const childEl = child as HastElement;

    if (childEl.tagName === 'thead') {
      for (const row of childEl.children) {
        if (row.type === 'element' && (row as HastElement).tagName === 'tr') {
          rows.push(hastTableRowToPlate(row as HastElement, true));
        }
      }
    } else if (childEl.tagName === 'tbody' || childEl.tagName === 'tfoot') {
      for (const row of childEl.children) {
        if (row.type === 'element' && (row as HastElement).tagName === 'tr') {
          rows.push(hastTableRowToPlate(row as HastElement, false));
        }
      }
    } else if (childEl.tagName === 'tr') {
      // Direct tr children (table without thead/tbody — common in Mammoth output)
      const isHeader = childEl.children.some(
        (c) => c.type === 'element' && (c as HastElement).tagName === 'th',
      );
      rows.push(hastTableRowToPlate(childEl, isHeader));
    }
  }

  return createTable(
    rows.length > 0
      ? rows
      : [createTableRow([createTableCell([createText('')])])],
  );
}

function hastTableRowToPlate(el: HastElement, isHeader: boolean): PlateElement {
  const cells = el.children
    .filter(
      (c): c is HastElement =>
        c.type === 'element' &&
        ['td', 'th'].includes((c as HastElement).tagName),
    )
    .map((cellEl) => {
      const header = isHeader || cellEl.tagName === 'th';
      return createTableCell(hastInlinesToPlate(cellEl.children), header);
    });
  return createTableRow(
    cells.length > 0 ? cells : [createTableCell([createText('')])],
  );
}

type HastInlineMarks = {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
};

function hastInlinesToPlate(
  children: HastChild[],
  marks: HastInlineMarks = {},
): (PlateText | PlateElement)[] {
  const result = children.flatMap((child) => hastInlineToPlate(child, marks));
  return result.length > 0 ? result : [createText('')];
}

function hastInlineToPlate(
  child: HastChild,
  marks: HastInlineMarks = {},
): (PlateText | PlateElement)[] {
  if (child.type === 'text') {
    const value = (child as HastText).value;
    if (!value) return [];
    return [createText(value, marks)];
  }

  if (child.type !== 'element') return [];
  const el = child as HastElement;

  switch (el.tagName) {
    case 'strong':
    case 'b':
      return el.children.flatMap((c) =>
        hastInlineToPlate(c, { ...marks, bold: true }),
      );
    case 'em':
    case 'i':
      return el.children.flatMap((c) =>
        hastInlineToPlate(c, { ...marks, italic: true }),
      );
    case 'del':
    case 's':
    case 'strike':
      return el.children.flatMap((c) =>
        hastInlineToPlate(c, { ...marks, strikethrough: true }),
      );
    case 'code':
      return [createText(hastExtractText(el), { ...marks, code: true })];
    case 'a': {
      const url = String(el.properties?.href ?? '');
      const children = el.children.flatMap((c) => hastInlineToPlate(c, marks));
      return [
        createLink(url, children.length > 0 ? children : [createText(url)]),
      ];
    }
    case 'img': {
      const url = String(el.properties?.src ?? '');
      const alt = String(el.properties?.alt ?? '');
      return [createImage(url, alt)];
    }
    case 'br':
      return [createText('\n')];
    case 'span':
      return el.children.flatMap((c) => hastInlineToPlate(c, marks));
    default:
      // Recurse into unknown elements (div, p inside inline context, etc.)
      return el.children.flatMap((c) => hastInlineToPlate(c, marks));
  }
}

function hastExtractText(el: HastElement): string {
  return el.children
    .map((child) => {
      if (child.type === 'text') return (child as HastText).value;
      if (child.type === 'element')
        return hastExtractText(child as HastElement);
      return '';
    })
    .join('');
}

function hastExtractLang(el: HastElement): string | undefined {
  const className = el.properties?.className;
  if (Array.isArray(className)) {
    for (const cls of className) {
      if (typeof cls === 'string' && cls.startsWith('language-')) {
        return cls.slice('language-'.length);
      }
    }
  }
  return undefined;
}
