/**
 * Client-side Plate editor configuration.
 * @platejs/* imports OK — frontend only.
 */
import {
  BasicBlocksPlugin,
  BasicMarksPlugin,
} from '@platejs/basic-nodes/react';
import {
  PlateElement,
  type PlateElementProps,
  type StyledPlateElementProps,
} from '@platejs/core/react';
import { ListPlugin } from '@platejs/list/react';
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from '@platejs/table/react';
import type { ReactElement } from 'react';

import { NodeType } from './plate-types';

// ---------------------------------------------------------------------------
// Element renderers
// ---------------------------------------------------------------------------
// Plate v52's PlateElement expects StyledPlateElementProps which differs from
// the PlateElementProps that components receive. The `pe()` cast bridges this
// gap — runtime props are always compatible.
function pe(props: PlateElementProps): StyledPlateElementProps {
  return props as unknown as StyledPlateElementProps;
}

function ParagraphElement(props: PlateElementProps) {
  return (
    <PlateElement {...pe(props)} className="mb-1 text-sm leading-relaxed" />
  );
}

function H1Element(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      className="mb-2 mt-5 text-lg font-semibold tracking-tight first:mt-0"
    />
  );
}

function H2Element(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      className="mb-1.5 mt-4 text-base font-semibold first:mt-0"
    />
  );
}

function H3Element(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      className="mb-1 mt-3 text-sm font-semibold first:mt-0"
    />
  );
}

function H4Element(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      className="mb-1 mt-2 text-sm font-medium first:mt-0"
    />
  );
}

function H5Element(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      className="mb-1 mt-2 text-sm font-medium first:mt-0"
    />
  );
}

function H6Element(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      className="mb-1 mt-2 text-sm font-medium text-muted-foreground first:mt-0"
    />
  );
}

function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      className="my-3 border-l-2 border-border pl-4 italic text-muted-foreground"
    />
  );
}

function CodeBlockElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      className="my-3 overflow-x-auto rounded-md bg-muted px-4 py-3 font-mono text-sm"
    />
  );
}

function CodeLineElement(props: PlateElementProps) {
  return <PlateElement {...pe(props)} />;
}

function HrElement(props: PlateElementProps) {
  return (
    <PlateElement {...pe(props)} className="py-2">
      <hr className="border-border" />
      {props.children}
    </PlateElement>
  );
}

function UlElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      className="my-2 ml-4 list-disc space-y-0.5 text-sm"
    />
  );
}

function OlElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      className="my-2 ml-4 list-decimal space-y-0.5 text-sm"
    />
  );
}

function LiElement(props: PlateElementProps) {
  return <PlateElement {...pe(props)} className="text-sm" />;
}

function LicElement(props: PlateElementProps) {
  return <PlateElement {...pe(props)} />;
}

function TableElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      as="table"
      className="my-3 w-full border-collapse text-sm"
    />
  );
}

function TableRowElement(props: PlateElementProps) {
  return (
    <PlateElement {...pe(props)} as="tr" className="border-b border-border" />
  );
}

function TableCellElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      as="td"
      className="border border-border px-3 py-2 text-sm"
    />
  );
}

function TableHeaderCellElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...pe(props)}
      as="th"
      className="border border-border bg-muted/50 px-3 py-2 text-left text-xs font-medium text-muted-foreground"
    />
  );
}

// ---------------------------------------------------------------------------
// Plugin list + component map
// ---------------------------------------------------------------------------

export const documentPlugins = [
  BasicBlocksPlugin,
  BasicMarksPlugin,
  TablePlugin,
  TableRowPlugin,
  TableCellPlugin,
  TableCellHeaderPlugin,
  ListPlugin,
];

export const documentComponents: Record<
  string,
  (props: PlateElementProps) => ReactElement | null
> = {
  [NodeType.P]: ParagraphElement,
  [NodeType.H1]: H1Element,
  [NodeType.H2]: H2Element,
  [NodeType.H3]: H3Element,
  [NodeType.H4]: H4Element,
  [NodeType.H5]: H5Element,
  [NodeType.H6]: H6Element,
  [NodeType.BLOCKQUOTE]: BlockquoteElement,
  [NodeType.CODE_BLOCK]: CodeBlockElement,
  [NodeType.CODE_LINE]: CodeLineElement,
  [NodeType.HR]: HrElement,
  [NodeType.UL]: UlElement,
  [NodeType.OL]: OlElement,
  [NodeType.LI]: LiElement,
  [NodeType.LIC]: LicElement,
  [NodeType.TABLE]: TableElement,
  [NodeType.TR]: TableRowElement,
  [NodeType.TD]: TableCellElement,
  [NodeType.TH]: TableHeaderCellElement,
};
