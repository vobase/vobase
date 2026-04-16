import { markdownToPlate } from '@modules/knowledge-base/lib/plate-deserialize';
import {
  documentComponents,
  documentPlugins,
} from '@modules/knowledge-base/lib/plate-editor-config';
import { plateToMarkdown } from '@modules/knowledge-base/lib/plate-serialize';
import {
  createParagraph,
  type PlateValue,
} from '@modules/knowledge-base/lib/plate-types';
import {
  Plate,
  PlateContent,
  useEditorRef,
  usePlateEditor,
} from '@platejs/core/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft, RotateCcw, Save } from 'lucide-react';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { agentsClient } from '@/lib/api-client';

const searchSchema = z.object({
  path: z.string(),
});

interface AgentDef {
  id: string;
  name: string;
  model: string;
  channels: string[] | null;
  mode: string | null;
  suggestions: string[] | null;
}

function EditorContent({
  agentId,
  agentName,
  path,
  initialMarkdown,
}: {
  agentId: string;
  agentName: string;
  path: string;
  initialMarkdown: string;
}) {
  const editor = useEditorRef();
  const queryClient = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const fileName = path.split('/').pop() ?? path;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const markdown = plateToMarkdown(editor.children as PlateValue);
      const res = await agentsClient.agents[':agentId'].file.$put(
        { param: { agentId } },
        {
          init: {
            body: JSON.stringify({ path, content: markdown }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to save');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['agent-file', agentId, path],
      });
      queryClient.invalidateQueries({ queryKey: ['agent-files', agentId] });
      setDirty(false);
    },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
        <Link
          to="/agents/$agentId"
          params={{ agentId }}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {agentName}
        </Link>

        <div className="h-4 w-px bg-border" />

        <span className="truncate text-sm font-medium">{fileName}</span>

        {dirty && (
          <span className="text-xs text-amber-600 shrink-0">Unsaved</span>
        )}

        <div className="flex shrink-0 items-center gap-2 ml-auto">
          {saveMutation.isError && (
            <span className="text-xs text-destructive">Save failed</span>
          )}
          {saveMutation.isSuccess && !dirty && !saveMutation.isPending && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              editor.tf.setValue(markdownToPlate(initialMarkdown));
              setDirty(false);
              saveMutation.reset();
            }}
            title="Revert to saved"
          >
            <RotateCcw className="h-3 w-3" />
            Revert
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !dirty}
          >
            <Save className="size-3" />
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-8 py-8">
          <PlateContent
            className="outline-none text-sm leading-relaxed [&_p]:whitespace-pre-wrap"
            aria-label={`Edit ${path}`}
            onInput={() => {
              if (!dirty) setDirty(true);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function FileEditor({
  agentId,
  agentName,
  path,
  markdown,
}: {
  agentId: string;
  agentName: string;
  path: string;
  markdown: string;
}) {
  const initialValue = markdownToPlate(markdown);
  const value = initialValue.length > 0 ? initialValue : [createParagraph()];

  const editor = usePlateEditor({
    plugins: documentPlugins,
    override: { components: documentComponents },
    value,
  });

  return (
    <Plate editor={editor}>
      <EditorContent
        agentId={agentId}
        agentName={agentName}
        path={path}
        initialMarkdown={markdown}
      />
    </Plate>
  );
}

function AgentFileEditorPage() {
  const { agentId } = Route.useParams();
  const { path } = Route.useSearch();

  const { data: agent } = useQuery<AgentDef>({
    queryKey: ['agent', agentId],
    queryFn: async () => {
      const res = await agentsClient.agents[':id'].$get({
        param: { id: agentId },
      });
      if (!res.ok) throw new Error('Failed to fetch agent');
      return res.json() as Promise<AgentDef>;
    },
    enabled: !!agentId,
  });

  const {
    data: file,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['agent-file', agentId, path],
    queryFn: async () => {
      // biome-ignore lint/style/noRestrictedGlobals: Hono RPC doesn't type query params without zValidator middleware (not installed)
      const res = await fetch(
        `/api/agents/agents/${encodeURIComponent(agentId)}/file?path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) throw new Error('Failed to fetch file');
      return res.json() as Promise<{
        id: string;
        path: string;
        content: string;
        writtenBy: string | null;
        updatedAt: string;
      }>;
    },
    enabled: !!agentId && !!path,
  });

  const agentName = agent?.name ?? agentId;

  if (isLoading) {
    return (
      <div className="p-6 space-y-3 max-w-3xl mx-auto">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (error || !file) {
    return (
      <Empty className="m-6 border">
        <EmptyHeader>
          <EmptyTitle>File not found</EmptyTitle>
          <EmptyDescription>
            <Link
              to="/agents/$agentId"
              params={{ agentId }}
              className="hover:text-primary"
            >
              Back to agent
            </Link>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <FileEditor
      agentId={agentId}
      agentName={agentName}
      path={path}
      markdown={file.content}
    />
  );
}

export const Route = createFileRoute('/_app/agents/$agentId/editor')({
  validateSearch: searchSchema,
  component: AgentFileEditorPage,
});
