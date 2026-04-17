import { AlertCircleIcon, CheckCircle2Icon } from 'lucide-react';
import { useEffect } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface ApprovedTemplate {
  id: string;
  name: string;
  language: string;
}

interface TemplateResolverProps {
  stepSequence: number;
  suggestion: string;
  approvedTemplates: ApprovedTemplate[];
  resolvedId: string | null;
  onResolve: (templateId: string, templateName: string) => void;
}

export function TemplateResolver({
  stepSequence,
  suggestion,
  approvedTemplates,
  resolvedId,
  onResolve,
}: TemplateResolverProps) {
  const exactMatch = approvedTemplates.find(
    (t) => t.name.toLowerCase() === suggestion.toLowerCase(),
  );

  useEffect(() => {
    if (exactMatch && !resolvedId) {
      onResolve(exactMatch.id, exactMatch.name);
    }
  }, [exactMatch, resolvedId, onResolve]);

  if (exactMatch) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
        <CheckCircle2Icon className="size-3.5 shrink-0" />
        <span className="font-mono">{suggestion}</span>
        <span className="text-muted-foreground text-xs">resolved</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
        <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Step #{stepSequence}: &ldquo;{suggestion}&rdquo; not found — pick a
          replacement:
        </span>
      </div>
      <Select
        value={resolvedId ?? ''}
        onValueChange={(id) => {
          const t = approvedTemplates.find((x) => x.id === id);
          if (t) onResolve(t.id, t.name);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select an approved template…" />
        </SelectTrigger>
        <SelectContent>
          {approvedTemplates.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {t.language}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
