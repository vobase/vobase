import { FileText } from 'lucide-react';

import { cn } from '@/lib/utils';

interface SourceCitationProps {
  sources: Array<{ documentTitle: string; relevanceScore?: number }>;
}

export function SourceCitation({ sources }: SourceCitationProps) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((source, index) => (
        <span
          key={source.documentTitle}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5',
            'text-xs text-muted-foreground max-w-[200px]',
            'transition-colors hover:bg-muted',
          )}
          title={source.documentTitle}
        >
          <FileText className="size-3 shrink-0" />
          <span className="truncate">{source.documentTitle}</span>
          {source.relevanceScore !== undefined && (
            <span className="shrink-0 tabular-nums opacity-60">
              {Math.round(source.relevanceScore * 100)}%
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
