/**
 * Server-side serialization: Plate Value → Markdown.
 *
 * IMPORTANT: Server-side only. NO React, NO @platejs/* imports.
 * Uses unified + remark-stringify + remark-gfm exclusively.
 */
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

import {
  NodeType,
  type PlateElement,
  type PlateText,
  type PlateValue,
} from './plate-types';

// ---------------------------------------------------------------------------
// Local mdast-compatible types (avoids direct mdast package import)
// ---------------------------------------------------------------------------

type MdText = { type: 'text'; value: string };
type MdStrong = { type: 'strong'; children: MdInline[] };
type MdEmphasis = { type: 'emphasis'; children: MdInline[] };
type MdDelete = { type: 'delete'; children: MdInline[] };
type MdInlineCode = { type: 'inlineCode'; value: string };
type MdLink = { type: 'link'; url: string; title: null; children: MdInline[] };
type MdImage = { type: 'image'; url: string; alt: string; title: null };
type MdBreak = { type: 'break' };
type MdInline =
  | MdText
  | MdStrong
  | MdEmphasis
  | MdDelete
  | MdInlineCode
  | MdLink
  | MdImage
  | MdBreak;

type MdParagraph = { type: 'paragraph'; children: MdInline[] };
type MdHeading = {
  type: 'heading';
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: MdInline[];
};
type MdBlockquote = { type: 'blockquote'; children: MdBlock[] };
type MdCode = { type: 'code'; lang: string | null; value: string };
type MdList = {
  type: 'list';
  ordered: boolean;
  spread: boolean;
  children: MdListItem[];
};
type MdListItem = {
  type: 'listItem';
  spread: boolean;
  children: MdBlock[];
};
type MdTableCell = { type: 'tableCell'; children: MdInline[] };
type MdTableRow = { type: 'tableRow'; children: MdTableCell[] };
type MdTable = {
  type: 'table';
  align: null[];
  children: MdTableRow[];
};
type MdThematicBreak = { type: 'thematicBreak' };
type MdBlock =
  | MdParagraph
  | MdHeading
  | MdBlockquote
  | MdCode
  | MdList
  | MdTable
  | MdThematicBreak;
type MdRoot = { type: 'root'; children: MdBlock[] };

// ---------------------------------------------------------------------------
// Plate Value → Markdown
// ---------------------------------------------------------------------------

export function plateToMarkdown(value: PlateValue): string {
  if (value.length === 0) return '';
  const root: MdRoot = {
    type: 'root',
    children: value.flatMap(plateBlockToMdast),
  };
  return unified()
    .use(remarkStringify)
    .use(remarkGfm)
    .stringify(root as never);
}

function isPlateText(node: PlateElement | PlateText): node is PlateText {
  return 'text' in node && typeof (node as PlateText).text === 'string';
}

function plateInlineToMdast(node: PlateElement | PlateText): MdInline[] {
  if (isPlateText(node)) {
    const t = node as PlateText;

    // Inline code: can't combine with other marks in markdown
    if (t.code) return [{ type: 'inlineCode', value: t.text }];

    let result: MdInline = { type: 'text', value: t.text };
    if (t.strikethrough)
      result = { type: 'delete', children: [result] } as MdDelete;
    if (t.italic)
      result = { type: 'emphasis', children: [result] } as MdEmphasis;
    if (t.bold) result = { type: 'strong', children: [result] } as MdStrong;

    return [result];
  }

  const el = node as PlateElement;
  switch (el.type) {
    case NodeType.A: {
      const children = el.children.flatMap((c) => plateInlineToMdast(c));
      return [
        {
          type: 'link',
          url: String(el.url ?? ''),
          title: null,
          children:
            children.length > 0
              ? children
              : [{ type: 'text', value: String(el.url ?? '') }],
        },
      ];
    }
    case NodeType.IMG:
      return [
        {
          type: 'image',
          url: String(el.url ?? ''),
          alt: String(el.alt ?? ''),
          title: null,
        },
      ];
    default:
      // Recurse into unknown inline elements
      return el.children.flatMap((c) => plateInlineToMdast(c));
  }
}

function plateInlinesToMdast(
  children: (PlateElement | PlateText)[],
): MdInline[] {
  const result = children.flatMap((c) => plateInlineToMdast(c));
  return result.length > 0 ? result : [{ type: 'text', value: '' }];
}

function plateBlockToMdast(node: PlateElement): MdBlock[] {
  switch (node.type) {
    case NodeType.H1:
    case NodeType.H2:
    case NodeType.H3:
    case NodeType.H4:
    case NodeType.H5:
    case NodeType.H6: {
      const depth = parseInt(node.type.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6;
      return [
        {
          type: 'heading',
          depth,
          children: plateInlinesToMdast(node.children),
        },
      ];
    }

    case NodeType.P:
      return [
        {
          type: 'paragraph',
          children: plateInlinesToMdast(node.children),
        },
      ];

    case NodeType.BLOCKQUOTE:
      return [
        {
          type: 'blockquote',
          children: [
            {
              type: 'paragraph',
              children: plateInlinesToMdast(node.children),
            },
          ],
        },
      ];

    case NodeType.CODE_BLOCK: {
      const lang =
        typeof node.lang === 'string' && node.lang ? node.lang : null;
      const lines = (node.children as PlateElement[]).map((line) =>
        line.children
          .map((c) => (isPlateText(c) ? (c as PlateText).text : ''))
          .join(''),
      );
      return [{ type: 'code', lang, value: lines.join('\n') }];
    }

    case NodeType.UL:
    case NodeType.OL:
      return [plateListToMdast(node)];

    case NodeType.TABLE:
      return [plateTableToMdast(node)];

    case NodeType.HR:
      return [{ type: 'thematicBreak' }];

    default: {
      // Fallback: treat children as inline content in a paragraph
      const inlines = plateInlinesToMdast(node.children);
      const hasContent = inlines.some(
        (i) => i.type !== 'text' || (i as MdText).value !== '',
      );
      if (hasContent) return [{ type: 'paragraph', children: inlines }];
      return [];
    }
  }
}

function plateListToMdast(node: PlateElement): MdList {
  const ordered = node.type === NodeType.OL;
  const items = (node.children as PlateElement[]).map(plateListItemToMdast);
  return { type: 'list', ordered, spread: false, children: items };
}

function plateListItemToMdast(li: PlateElement): MdListItem {
  const blocks: MdBlock[] = [];

  for (const child of li.children as PlateElement[]) {
    if (child.type === NodeType.LIC) {
      blocks.push({
        type: 'paragraph',
        children: plateInlinesToMdast(child.children),
      });
    } else if (child.type === NodeType.UL || child.type === NodeType.OL) {
      blocks.push(plateListToMdast(child));
    }
  }

  return {
    type: 'listItem',
    spread: false,
    children:
      blocks.length > 0
        ? blocks
        : [{ type: 'paragraph', children: [{ type: 'text', value: '' }] }],
  };
}

function plateTableToMdast(node: PlateElement): MdTable {
  const rows = (node.children as PlateElement[]).map((row) => {
    const cells = (row.children as PlateElement[]).map((cell) => {
      // Cell wraps a paragraph: td > p > inline...
      const para = (cell.children as PlateElement[])[0];
      const inline = para
        ? plateInlinesToMdast(para.children)
        : ([{ type: 'text', value: '' }] as MdInline[]);
      return { type: 'tableCell' as const, children: inline };
    });
    return { type: 'tableRow' as const, children: cells };
  });

  return {
    type: 'table',
    align: rows[0]?.children.map(() => null) ?? [],
    children: rows,
  };
}
