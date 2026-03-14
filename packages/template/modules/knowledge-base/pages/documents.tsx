import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  FileText,
  FileSpreadsheet,
  FileImage,
  FileCode,
  File,
  Upload,
  Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/page-header';

async function fetchDocuments() {
  const res = await fetch('/api/knowledge-base/documents');
  if (!res.ok) throw new Error('Failed to fetch documents');
  return res.json() as Promise<
    Array<{
      id: string;
      title: string;
      sourceType: string;
      status: string;
      chunkCount: number;
      mimeType: string;
      createdAt: string;
    }>
  >;
}

type StatusVariant = 'default' | 'secondary' | 'destructive' | 'outline';

const statusConfig: Record<string, { variant: StatusVariant; label: string }> = {
  ready: { variant: 'default', label: 'Ready' },
  processing: { variant: 'secondary', label: 'Processing' },
  pending: { variant: 'outline', label: 'Pending' },
  error: { variant: 'destructive', label: 'Error' },
  needs_ocr: { variant: 'secondary', label: 'Needs OCR' },
};

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return FileSpreadsheet;
  if (mimeType.includes('html') || mimeType.includes('xml') || mimeType.includes('json'))
    return FileCode;
  if (mimeType.includes('pdf') || mimeType.includes('word') || mimeType.includes('text'))
    return FileText;
  return File;
}

function DocumentsPage() {
  const queryClient = useQueryClient();
  const { data: documents, isLoading } = useQuery({
    queryKey: ['kb-documents'],
    queryFn: fetchDocuments,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/knowledge-base/documents', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kb-documents'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/knowledge-base/documents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kb-documents'] }),
  });

  function handleFileUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.html,.txt,.md,.csv';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) uploadMutation.mutate(file);
    };
    input.click();
  }

  return (
    <div className="p-6">
      <PageHeader title="Documents" description="Manage knowledge base documents">
        <Button onClick={handleFileUpload} disabled={uploadMutation.isPending} size="sm">
          <Upload className="mr-2 h-4 w-4" />
          {uploadMutation.isPending ? 'Uploading…' : 'Upload document'}
        </Button>
      </PageHeader>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && documents && documents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No documents yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload a document to start building your knowledge base.
          </p>
          <Button onClick={handleFileUpload} size="sm" className="mt-4">
            <Upload className="mr-2 h-4 w-4" />
            Upload document
          </Button>
        </div>
      )}

      {documents && documents.length > 0 && (
        <div className="space-y-2">
          {documents.map((doc) => {
            const Icon = getFileIcon(doc.mimeType);
            const status = statusConfig[doc.status] ?? { variant: 'outline' as StatusVariant, label: doc.status };
            return (
              <Card key={doc.id} className="transition-colors hover:bg-muted/30">
                <CardContent className="flex items-center justify-between py-3 px-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{doc.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {doc.chunkCount} {doc.chunkCount === 1 ? 'chunk' : 'chunks'} &middot;{' '}
                        {doc.sourceType}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 ml-4">
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(doc.id)}
                      disabled={deleteMutation.isPending}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/knowledge-base/documents')({
  component: DocumentsPage,
});
