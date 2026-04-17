import type { AudienceFilter } from '@modules/messaging/lib/audience-filter';
import type { DraftRule } from '@modules/messaging/lib/automation-parse-schema';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeftIcon, SparklesIcon } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { messagingClient } from '@/lib/api-client';
import { cronToHuman, ruleTypeLabel } from './helpers';
import { ParameterEditor } from './parameter-editor';
import { type ApprovedTemplate, TemplateResolver } from './template-resolver';

// ─── Helpers ────────────────────────────────────────────────────────

function audienceFilterSummary(filter: AudienceFilter | undefined): string {
  if (!filter) return 'All contacts';
  const parts: string[] = [];
  if (filter.roles?.length) parts.push(`Roles: ${filter.roles.join(', ')}`);
  if (filter.labelIds?.length) parts.push(`${filter.labelIds.length} label(s)`);
  if (filter.attributes?.length) {
    for (const a of filter.attributes) {
      parts.push(`${a.key} ${a.op ?? '='} ${a.value}`);
    }
  }
  if (filter.excludeOptedOut) parts.push('exclude opted-out');
  return parts.length ? parts.join(' · ') : 'All contacts (exclude opted-out)';
}

function hasAudienceConditions(filter: AudienceFilter | undefined): boolean {
  if (!filter) return false;
  return (
    (filter.roles?.length ?? 0) > 0 ||
    (filter.labelIds?.length ?? 0) > 0 ||
    (filter.attributes?.length ?? 0) > 0
  );
}

// ─── Data fetching ────────────────────────────────────────────────────

async function fetchApprovedTemplates(): Promise<ApprovedTemplate[]> {
  const res = await messagingClient.templates.$get();
  if (!res.ok) return [];
  const json = (await res.json()) as {
    templates: Array<{
      id: string;
      name: string;
      language: string;
      status: string;
    }>;
  };
  return json.templates.filter((t) => t.status === 'APPROVED');
}

async function fetchWhatsAppInstanceId(): Promise<string> {
  const res = await messagingClient.instances.$get();
  if (!res.ok) throw new Error('No channel instances found');
  const instances = (await res.json()) as Array<{ id: string; type: string }>;
  const wa = instances.find((i) => i.type === 'whatsapp');
  if (!wa) throw new Error('No WhatsApp channel configured');
  return wa.id;
}

// ─── Props ───────────────────────────────────────────────────────────

interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─── Step 1 ──────────────────────────────────────────────────────────

interface Step1Props {
  prompt: string;
  onPromptChange: (v: string) => void;
  onParsed: (draft: DraftRule) => void;
}

function Step1({ prompt, onPromptChange, onParsed }: Step1Props) {
  const parseMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.automation.rules.parse.$post(
        {},
        {
          init: {
            body: JSON.stringify({ prompt }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Parse failed');
      }
      const data = (await res.json()) as { draft: DraftRule };
      return data.draft;
    },
    onSuccess: (draft) => onParsed(draft),
    onError: (err: Error) =>
      toast.error(err.message || 'Failed to parse prompt'),
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Describe your automation rule in plain language. Be specific about
        timing, audience, and what message to send.
      </p>
      <Textarea
        placeholder="e.g. Send a weekly Tuesday 11am lunch promo to contacts with spend_tier medium or higher"
        className="min-h-[120px] resize-none font-mono text-sm"
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        disabled={parseMutation.isPending}
      />
      <Button
        className="self-end gap-2"
        onClick={() => parseMutation.mutate()}
        disabled={!prompt.trim() || parseMutation.isPending}
      >
        <SparklesIcon className="size-3.5" />
        {parseMutation.isPending ? 'Parsing…' : 'Parse'}
      </Button>
    </div>
  );
}

// ─── Step 2 ──────────────────────────────────────────────────────────

interface Step2Props {
  draft: DraftRule;
  approvedTemplates: ApprovedTemplate[];
  onBack: () => void;
  onCreated: (ruleId: string) => void;
}

function Step2({ draft, approvedTemplates, onBack, onCreated }: Step2Props) {
  const [parameters, setParameters] = useState<Record<string, unknown>>(
    () => draft.parameters ?? {},
  );
  const [resolvedTemplates, setResolvedTemplates] = useState<
    Record<number, { id: string; name: string }>
  >({});

  const handleResolve = useCallback((seq: number, id: string, name: string) => {
    setResolvedTemplates((prev) => ({ ...prev, [seq]: { id, name } }));
  }, []);

  const allResolved = draft.steps.every((s) => !!resolvedTemplates[s.sequence]);
  const hasConditions = hasAudienceConditions(draft.audienceFilter);
  const canCreate = allResolved && hasConditions;

  const createMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      const channelInstanceId = await fetchWhatsAppInstanceId();
      const body = {
        name: draft.name,
        description: draft.description,
        type: draft.type,
        channelInstanceId,
        audienceFilter: draft.audienceFilter,
        schedule: draft.schedule,
        dateAttribute: draft.dateAttribute,
        timezone: draft.timezone ?? 'UTC',
        parameters,
        parameterSchema: draft.parameterSchema ?? {},
        steps: draft.steps.map((s) => ({
          sequence: s.sequence,
          offsetDays: s.offsetDays,
          sendAtTime: s.sendAtTime,
          delayHours: s.delayHours,
          templateId: resolvedTemplates[s.sequence].id,
          templateName: resolvedTemplates[s.sequence].name,
          templateLanguage:
            approvedTemplates.find(
              (t) => t.id === resolvedTemplates[s.sequence].id,
            )?.language ?? 'en',
          variableMapping: s.variableMapping ?? {},
          isFinal: s.isFinal ?? false,
        })),
      };

      const res = await messagingClient.automation.rules.$post(
        {},
        {
          init: {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to create rule');
      const row = (await res.json()) as { id: string };

      if (!isActive) {
        await messagingClient.automation.rules[':id'].pause.$post({
          param: { id: row.id },
        });
      }

      return row.id;
    },
    onSuccess: (id) => onCreated(id),
    onError: (err: Error) =>
      toast.error(err.message || 'Failed to create rule'),
  });

  const scheduleLabel =
    draft.type === 'recurring'
      ? cronToHuman(draft.schedule ?? null)
      : draft.dateAttribute
        ? `On ${draft.dateAttribute}`
        : '—';

  return (
    <div
      className="flex flex-col gap-5 overflow-y-auto"
      style={{ maxHeight: '60vh' }}
    >
      {/* Preview header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold">{draft.name}</span>
          <Badge variant="outline" className="text-xs">
            {ruleTypeLabel(draft.type)}
          </Badge>
        </div>
        {draft.description && (
          <p className="text-muted-foreground text-sm">{draft.description}</p>
        )}
      </div>

      {/* Schedule + audience summary */}
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Schedule</span>
          <span className="font-mono text-xs">{scheduleLabel}</span>
        </div>
        <div className="mt-1.5 flex justify-between gap-4">
          <span className="text-muted-foreground">Audience</span>
          <span className="text-right text-xs">
            {audienceFilterSummary(draft.audienceFilter)}
          </span>
        </div>
        {!hasConditions && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Add at least one audience condition before creating.
          </p>
        )}
      </div>

      {/* Steps + template resolver */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Steps ({draft.steps.length})</p>
        {draft.steps.map((step) => (
          <div
            key={step.sequence}
            className="flex flex-col gap-2 rounded-lg border bg-card p-3"
          >
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground font-mono text-xs">
                #{step.sequence}
              </span>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {step.offsetDays != null && <span>Day +{step.offsetDays}</span>}
                {step.delayHours != null && (
                  <span>+{step.delayHours}h delay</span>
                )}
                {step.sendAtTime && <span>@ {step.sendAtTime}</span>}
                {step.isFinal && (
                  <Badge variant="outline" className="h-4 px-1 text-xs">
                    final
                  </Badge>
                )}
              </div>
            </div>
            <TemplateResolver
              stepSequence={step.sequence}
              suggestion={step.templateSuggestion}
              approvedTemplates={approvedTemplates}
              resolvedId={resolvedTemplates[step.sequence]?.id ?? null}
              onResolve={(id, name) => handleResolve(step.sequence, id, name)}
            />
          </div>
        ))}
      </div>

      {/* Parameter editor */}
      {draft.parameterSchema &&
        Object.keys(draft.parameterSchema).length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Parameters</p>
            <ParameterEditor
              schema={draft.parameterSchema}
              values={parameters}
              onSave={async (vals) => setParameters(vals)}
            />
          </div>
        )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-2 border-t">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
          <ArrowLeftIcon className="size-3.5" />
          Back
        </Button>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => createMutation.mutate(false)}
          disabled={!allResolved || createMutation.isPending}
        >
          Save as draft
        </Button>
        <Button
          size="sm"
          onClick={() => createMutation.mutate(true)}
          disabled={!canCreate || createMutation.isPending}
        >
          {createMutation.isPending ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </div>
  );
}

// ─── Dialog ──────────────────────────────────────────────────────────

export function PromptDialog({ open, onOpenChange }: PromptDialogProps) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<DraftRule | null>(null);

  const { data: approvedTemplates = [] } = useQuery({
    queryKey: ['approved-templates'],
    queryFn: fetchApprovedTemplates,
    enabled: open,
  });

  function handleParsed(d: DraftRule) {
    setDraft(d);
  }

  function handleBack() {
    setDraft(null);
  }

  function handleCreated(ruleId: string) {
    onOpenChange(false);
    setPrompt('');
    setDraft(null);
    navigate({ to: '/campaigns/rules/$ruleId', params: { ruleId } });
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      setDraft(null);
    }
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {draft ? 'Review rule draft' : 'New automation rule'}
          </DialogTitle>
        </DialogHeader>

        {draft ? (
          <Step2
            draft={draft}
            approvedTemplates={approvedTemplates}
            onBack={handleBack}
            onCreated={handleCreated}
          />
        ) : (
          <Step1
            prompt={prompt}
            onPromptChange={setPrompt}
            onParsed={handleParsed}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
