import { documentComponents, documentPlugins } from '@modules/knowledge-base/lib/plate-editor-config'
import { createParagraph, NodeType, type PlateValue } from '@modules/knowledge-base/lib/plate-types'
import { withBlockControls } from '@modules/knowledge-base/pages/components/-block-controls'
import { Plate, PlateContent, useEditorRef, usePlateEditor } from '@platejs/core/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ChevronLeft, Eye, FileText, Pencil, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Status, StatusIndicator, StatusLabel } from '@/components/ui/status'
import { knowledgeBaseClient } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// Controlled component map (top-level blocks get the exclude toggle)
// ---------------------------------------------------------------------------

const CONTROLLED_TYPES = new Set<string>([
  NodeType.P,
  NodeType.H1,
  NodeType.H2,
  NodeType.H3,
  NodeType.H4,
  NodeType.H5,
  NodeType.H6,
  NodeType.BLOCKQUOTE,
  NodeType.CODE_BLOCK,
  NodeType.HR,
  NodeType.UL,
  NodeType.OL,
])

const controlledComponents = Object.fromEntries(
  Object.entries(documentComponents).map(([type, Comp]) => [
    type,
    CONTROLLED_TYPES.has(type) ? withBlockControls(Comp) : Comp,
  ]),
)

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchDocument(id: string) {
  const res = await knowledgeBaseClient.documents[':id'].$get({
    param: { id },
  })
  if (!res.ok) throw new Error('Failed to fetch document')
  return res.json()
}

type DocStatusVariant = 'default' | 'success' | 'error' | 'warning' | 'info'

const DOC_STATUS_VARIANT: Record<string, DocStatusVariant> = {
  ready: 'success',
  processing: 'warning',
  pending: 'default',
  error: 'error',
  needs_ocr: 'warning',
}

const DOC_STATUS_LABEL: Record<string, string> = {
  ready: 'Ready',
  processing: 'Processing',
  pending: 'Pending',
  error: 'Error',
  needs_ocr: 'Needs OCR',
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type Doc = Awaited<ReturnType<typeof fetchDocument>>

function ViewerContent({ doc }: { doc: Doc }) {
  const editor = useEditorRef()
  const [readOnly, setReadOnly] = useState(true)
  const [savedCount, setSavedCount] = useState(0)

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await knowledgeBaseClient.documents[':id'].content.$patch(
        { param: { id: doc.id } },
        {
          init: {
            body: JSON.stringify({ content: editor.children as PlateValue }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      )
      if (!res.ok) throw new Error('Save failed')
      return res.json()
    },
    onSuccess: () => setSavedCount((n) => n + 1),
  })

  const variant = DOC_STATUS_VARIANT[doc.status] ?? 'default'
  const statusLabel = DOC_STATUS_LABEL[doc.status] ?? doc.status

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
        <Link to="/agents" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Agents
        </Link>

        <div className="h-4 w-px bg-border" />

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{doc.title}</span>
          <Status variant={variant} className="shrink-0">
            <StatusIndicator />
            <StatusLabel>{statusLabel}</StatusLabel>
          </Status>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!readOnly && saveMutation.error && <span className="text-xs text-destructive">Save failed</span>}
          {!readOnly && savedCount > 0 && !saveMutation.isPending && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {!readOnly && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => {
                  editor.tf.setValue((doc.content as PlateValue) ?? [createParagraph()])
                  setSavedCount(0)
                }}
                title="Revert to saved"
              >
                <RotateCcw className="h-3 w-3" />
                Revert
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => setReadOnly((r) => !r)}>
            {readOnly ? (
              <>
                <Pencil className="h-3 w-3" />
                Edit
              </>
            ) : (
              <>
                <Eye className="h-3 w-3" />
                Preview
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Document info bar */}
      <div className="flex shrink-0 items-center gap-3 border-b bg-muted/30 px-6 py-1.5 text-xs text-muted-foreground">
        <span>{doc.mimeType}</span>
        <span>&middot;</span>
        <span>
          {doc.chunkCount} {doc.chunkCount === 1 ? 'chunk' : 'chunks'}
        </span>
        <span>&middot;</span>
        <span>{doc.sourceType}</span>
        {!readOnly && (
          <>
            <span>&middot;</span>
            <span className="text-amber-600">Editing — hover blocks to toggle search inclusion</span>
          </>
        )}
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-8">
          <PlateContent
            readOnly={readOnly}
            className="outline-none text-sm leading-relaxed"
            aria-label="Document content"
          />
        </div>
      </div>
    </div>
  )
}

function DocumentViewer({ doc }: { doc: Doc }) {
  const initialValue = (doc.content as PlateValue | null) ?? [createParagraph()]

  const editor = usePlateEditor({
    plugins: documentPlugins,
    override: { components: controlledComponents },
    value: initialValue,
  })

  return (
    <Plate editor={editor}>
      <ViewerContent doc={doc} />
    </Plate>
  )
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function KbDocumentDetailPage() {
  const { id } = Route.useParams()
  const {
    data: doc,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['kb-documents', id],
    queryFn: () => fetchDocument(id),
  })

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm font-medium">Document not found</p>
        <Link to="/agents" className="mt-2 text-xs text-muted-foreground hover:text-foreground">
          Back to agents
        </Link>
      </div>
    )
  }

  return <DocumentViewer doc={doc} />
}

export const Route = createFileRoute('/_app/agents/kb/$id')({
  component: KbDocumentDetailPage,
})
