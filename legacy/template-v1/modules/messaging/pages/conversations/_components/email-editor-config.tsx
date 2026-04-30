/**
 * Minimal Plate.js config for the email reply editor.
 * Intentionally limited to paragraphs + basic marks + lists only.
 * Do NOT add heading styles, tables, code blocks, or other KB-editor features.
 */
import { BasicBlocksPlugin, BasicMarksPlugin } from '@platejs/basic-nodes/react'
import { PlateElement, type PlateElementProps, type StyledPlateElementProps } from '@platejs/core/react'
import { ListPlugin } from '@platejs/list/react'
import type { ReactElement } from 'react'

// Plate v52: PlateElement expects StyledPlateElementProps; this cast is safe at runtime.
function pe(props: PlateElementProps): StyledPlateElementProps {
  return props as unknown as StyledPlateElementProps
}

function ParagraphElement(props: PlateElementProps) {
  return <PlateElement {...pe(props)} className="mb-1 text-sm leading-relaxed" />
}

function UlElement(props: PlateElementProps) {
  return <PlateElement {...pe(props)} className="my-1 ml-4 list-disc space-y-0.5 text-sm" />
}

function OlElement(props: PlateElementProps) {
  return <PlateElement {...pe(props)} className="my-1 ml-4 list-decimal space-y-0.5 text-sm" />
}

function LiElement(props: PlateElementProps) {
  return <PlateElement {...pe(props)} className="text-sm" />
}

function LicElement(props: PlateElementProps) {
  return <PlateElement {...pe(props)} />
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const emailEditorPlugins = [BasicBlocksPlugin, BasicMarksPlugin, ListPlugin]

export const emailEditorComponents: Record<string, (props: PlateElementProps) => ReactElement | null> = {
  p: ParagraphElement,
  ul: UlElement,
  ol: OlElement,
  li: LiElement,
  lic: LicElement,
}
