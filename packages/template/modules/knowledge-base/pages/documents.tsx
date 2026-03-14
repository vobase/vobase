import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ready: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  needs_ocr: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
};

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Documents</h2>
          <p className="text-sm text-muted-foreground">Manage knowledge base documents</p>
        </div>
        <Button onClick={handleFileUpload} disabled={uploadMutation.isPending}>
          {uploadMutation.isPending ? 'Uploading...' : 'Upload document'}
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {documents && documents.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          No documents yet. Upload a document to get started.
        </p>
      )}

      {documents && documents.length > 0 && (
        <div className="space-y-2">
          {documents.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{doc.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.chunkCount} chunks &middot; {doc.sourceType}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={statusColors[doc.status] ?? ''} variant="secondary">
                    {doc.status}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(doc.id)}
                    disabled={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/knowledge-base/documents')({
  component: DocumentsPage,
});
