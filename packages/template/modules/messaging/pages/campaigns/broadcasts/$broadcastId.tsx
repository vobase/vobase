import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  CalendarIcon,
  FilterIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Status, StatusIndicator, StatusLabel } from '@/components/ui/status';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { messagingClient } from '@/lib/api-client';
import {
  broadcastStatusVariant,
  type StatusVariant,
  statusLabel,
} from './_lib/helpers';

// ─── Types ───────────────────────────────────────────────────────────

interface Broadcast {
  id: string;
  name: string;
  channelInstanceId: string;
  templateId: string;
  templateName: string;
  templateLanguage: string;
  variableMapping: Record<string, string> | null;
  status: string;
  scheduledAt: string | null;
  timezone: string | null;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Template {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string | null;
  components: string | null;
}

interface Recipient {
  id: string;
  contactId: string;
  phone: string;
  variables: Record<string, string> | null;
  status: string;
  failureReason: string | null;
  sentAt: string | null;
}

interface UploadSummary {
  created: number;
  skipped: number;
  invalid: number;
  errors: string[];
}

interface AvailableLabel {
  id: string;
  title: string;
  color: string | null;
}

interface AttributeDefinition {
  id: string;
  key: string;
  label: string;
  type: string;
}

interface AudiencePreview {
  total: number;
  sample: Array<{
    id: string;
    name: string | null;
    phone: string | null;
    role: string;
  }>;
}

interface AudienceFilter {
  roles: string[];
  labelIds: string[];
  attributes: Array<{ key: string; value: string }>;
  excludeOptedOut: boolean;
}

function recipientStatusVariant(status: string): StatusVariant {
  switch (status) {
    case 'queued':
      return 'default';
    case 'sent':
      return 'info';
    case 'delivered':
      return 'success';
    case 'read':
      return 'success';
    case 'failed':
      return 'error';
    case 'skipped':
      return 'warning';
    default:
      return 'default';
  }
}

// ─── Template helpers ───────────────────────────────────────────────

function extractTemplateVariables(components: string | null): string[] {
  if (!components) return [];
  try {
    const parsed = JSON.parse(components) as Array<{
      type: string;
      text?: string;
    }>;
    const vars: string[] = [];
    for (const comp of parsed) {
      if (comp.text) {
        const matches = comp.text.match(/\{\{\d+\}\}/g);
        if (matches) {
          for (const m of matches) {
            if (!vars.includes(m)) vars.push(m);
          }
        }
      }
    }
    return vars.sort();
  } catch {
    return [];
  }
}

function getTemplateBodyPreview(components: string | null): string {
  if (!components) return '';
  try {
    const parsed = JSON.parse(components) as Array<{
      type: string;
      text?: string;
    }>;
    const body = parsed.find((c) => c.type === 'BODY');
    return body?.text ?? '';
  } catch {
    return '';
  }
}

function parseCsvHeaders(csvText: string): string[] {
  const firstLine = csvText.split('\n')[0];
  if (!firstLine) return [];
  return firstLine.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
}

// ─── Page ─────────────────────────────────────────────────────────────

function BroadcastDetailPage() {
  const { broadcastId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [audienceMode, setAudienceMode] = useState<'csv' | 'filter'>('csv');
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>({
    roles: [],
    labelIds: [],
    attributes: [],
    excludeOptedOut: true,
  });
  const [csvText, setCsvText] = useState<string | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(
    null,
  );
  const [variableMapping, setVariableMapping] = useState<
    Record<string, string>
  >({});
  const [saveAsLabel, setSaveAsLabel] = useState(false);
  const [labelName, setLabelName] = useState('');
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);

  // ─── Queries ─────────────────────────────────────────────────────

  const { data: broadcast, isLoading: broadcastLoading } = useQuery({
    queryKey: ['broadcasts', broadcastId],
    queryFn: async () => {
      const res = await messagingClient.broadcasts[':id'].$get({
        param: { id: broadcastId },
      });
      if (!res.ok) throw new Error('Failed to fetch broadcast');
      return res.json() as Promise<Broadcast>;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'sending' ? 3000 : false;
    },
  });

  const { data: templatesData } = useQuery({
    queryKey: ['messaging-templates'],
    queryFn: async () => {
      const res = await messagingClient.templates.$get();
      if (!res.ok) throw new Error('Failed to fetch templates');
      const json = (await res.json()) as { templates: Template[] };
      return json.templates;
    },
  });

  const { data: recipientsData } = useQuery({
    queryKey: ['broadcasts', broadcastId, 'recipients'],
    queryFn: async () => {
      const res = await messagingClient.broadcasts[':id'].recipients.$get({
        param: { id: broadcastId },
      });
      if (!res.ok) throw new Error('Failed to fetch recipients');
      return res.json() as Promise<{ data: Recipient[]; total: number }>;
    },
    enabled: !!broadcast,
  });

  const { data: allLabels = [] } = useQuery({
    queryKey: ['labels'],
    queryFn: async () => {
      const res = await messagingClient.labels.$get();
      if (!res.ok) return [];
      return res.json() as unknown as Promise<AvailableLabel[]>;
    },
    staleTime: 300_000,
  });

  const { data: attrDefs = [] } = useQuery({
    queryKey: ['attribute-definitions'],
    queryFn: async () => {
      const res = await messagingClient['attribute-definitions'].$get();
      if (!res.ok) return [];
      const json = (await res.json()) as { data: AttributeDefinition[] };
      return json.data;
    },
    staleTime: 300_000,
  });

  const hasActiveFilter =
    audienceFilter.roles.length > 0 ||
    audienceFilter.labelIds.length > 0 ||
    audienceFilter.attributes.length > 0;

  const { data: audiencePreview, isFetching: isPreviewFetching } = useQuery({
    queryKey: ['broadcasts', broadcastId, 'audience-preview', audienceFilter],
    queryFn: async () => {
      const res = await messagingClient.broadcasts[':id'][
        'audience-preview'
      ].$post(
        { param: { id: broadcastId } },
        {
          init: {
            body: JSON.stringify(audienceFilter),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to preview audience');
      return res.json() as Promise<AudiencePreview>;
    },
    enabled: !!broadcast && hasActiveFilter,
  });

  const templates = templatesData ?? [];
  const approvedTemplates = useMemo(
    () => templates.filter((t) => t.status === 'APPROVED'),
    [templates],
  );
  const recipients = recipientsData?.data ?? [];
  const isDraft = broadcast?.status === 'draft';
  const hasTemplate =
    broadcast?.templateName && broadcast.templateName !== '_placeholder';

  const selectedTemplate = useMemo(
    () =>
      broadcast && hasTemplate
        ? templates.find(
            (t) =>
              t.name === broadcast.templateName &&
              t.language === broadcast.templateLanguage,
          )
        : null,
    [broadcast, hasTemplate, templates],
  );

  const templateVars = useMemo(
    () => extractTemplateVariables(selectedTemplate?.components ?? null),
    [selectedTemplate],
  );

  const bodyPreview = useMemo(() => {
    const raw = getTemplateBodyPreview(selectedTemplate?.components ?? null);
    if (!raw || Object.keys(variableMapping).length === 0) return raw;
    let preview = raw;
    for (const [variable, column] of Object.entries(variableMapping)) {
      if (column) {
        preview = preview.replace(variable, `[${column}]`);
      }
    }
    return preview;
  }, [selectedTemplate, variableMapping]);

  // ─── Mutations ───────────────────────────────────────────────────

  const invalidateBroadcast = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['broadcasts', broadcastId] });
    queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
  }, [queryClient, broadcastId]);

  const updateMutation = useMutation({
    mutationFn: async (
      data: Partial<{
        name: string;
        templateId: string;
        templateName: string;
        templateLanguage: string;
        variableMapping: Record<string, string>;
        scheduledAt: string;
        timezone: string;
      }>,
    ) => {
      const res = await messagingClient.broadcasts[':id'].$put(
        { param: { id: broadcastId } },
        {
          init: {
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to update broadcast');
      return res.json();
    },
    onSuccess: () => {
      invalidateBroadcast();
      setEditingName(null);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const uploadRecipientsMutation = useMutation({
    mutationFn: async (payload: {
      csvText: string;
      variableMapping: Record<string, string>;
      saveAsLabel?: string;
    }) => {
      const res = await messagingClient.broadcasts[':id'].recipients.$post(
        { param: { id: broadcastId } },
        {
          init: {
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to upload recipients');
      return res.json() as Promise<UploadSummary>;
    },
    onSuccess: (summary) => {
      setUploadSummary(summary);
      invalidateBroadcast();
      queryClient.invalidateQueries({
        queryKey: ['broadcasts', broadcastId, 'recipients'],
      });
      if (summary.created > 0) {
        toast.success(`${summary.created} recipients added`);
      }
      if (summary.invalid > 0) {
        toast.warning(`${summary.invalid} rows had invalid phone numbers`);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const addFromFilterMutation = useMutation({
    mutationFn: async (filter: AudienceFilter) => {
      const res = await messagingClient.broadcasts[':id']['audience-add'].$post(
        { param: { id: broadcastId } },
        {
          init: {
            body: JSON.stringify(filter),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to add recipients from filter');
      return res.json() as Promise<{
        added: number;
        skipped: number;
        total: number;
      }>;
    },
    onSuccess: (result) => {
      invalidateBroadcast();
      queryClient.invalidateQueries({
        queryKey: ['broadcasts', broadcastId, 'recipients'],
      });
      toast.success(`${result.added} recipients added from filter`);
      if (result.skipped > 0) {
        toast.info(`${result.skipped} skipped (duplicates or no phone)`);
      }
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.broadcasts[':id'].send.$post({
        param: { id: broadcastId },
      });
      if (!res.ok) throw new Error('Failed to send broadcast');
      return res.json();
    },
    onSuccess: () => {
      invalidateBroadcast();
      toast.success('Broadcast sending started');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: async (payload: { scheduledAt: string; timezone?: string }) => {
      const res = await messagingClient.broadcasts[':id'].schedule.$post(
        { param: { id: broadcastId } },
        {
          init: {
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to schedule broadcast');
      return res.json();
    },
    onSuccess: () => {
      invalidateBroadcast();
      toast.success('Broadcast scheduled');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.broadcasts[':id'].cancel.$post({
        param: { id: broadcastId },
      });
      if (!res.ok) throw new Error('Failed to cancel broadcast');
      return res.json();
    },
    onSuccess: () => {
      invalidateBroadcast();
      toast.success('Broadcast cancelled');
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const retryMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.broadcasts[':id']['retry-failed'].$post(
        { param: { id: broadcastId } },
      );
      if (!res.ok) throw new Error('Failed to retry');
      return res.json() as Promise<{ ok: boolean; retryCount: number }>;
    },
    onSuccess: (data) => {
      invalidateBroadcast();
      queryClient.invalidateQueries({
        queryKey: ['broadcasts', broadcastId, 'recipients'],
      });
      toast.success(`Retrying ${data.retryCount} failed recipients`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await messagingClient.broadcasts[':id'].$delete({
        param: { id: broadcastId },
      });
      if (!res.ok) throw new Error('Failed to delete broadcast');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      toast.success('Broadcast deleted');
      navigate({ to: '/campaigns/broadcasts' });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  // ─── Handlers ────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setCsvText(text);
      setCsvHeaders(parseCsvHeaders(text));
      setUploadSummary(null);
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setCsvText(text);
      setCsvHeaders(parseCsvHeaders(text));
      setUploadSummary(null);
    };
    reader.readAsText(file);
  }

  function handleUploadRecipients() {
    if (!csvText) return;
    uploadRecipientsMutation.mutate({
      csvText,
      variableMapping,
      saveAsLabel: saveAsLabel && labelName ? labelName : undefined,
    });
  }

  function handleTemplateSelect(templateKey: string) {
    // templateKey is "name::language" to handle uniqueness
    const [name, language] = templateKey.split('::');
    const tmpl = approvedTemplates.find(
      (t) => t.name === name && t.language === language,
    );
    if (!tmpl || !broadcast) return;

    updateMutation.mutate({
      templateId: tmpl.id,
      templateName: tmpl.name,
      templateLanguage: tmpl.language,
      // Auto-update name if still untitled
      ...(broadcast.name === 'Untitled Broadcast' && { name: tmpl.name }),
    });
    // Reset variable mapping when template changes
    setVariableMapping({});
  }

  function handleSendNow() {
    sendMutation.mutate();
  }

  // ─── Loading ─────────────────────────────────────────────────────

  if (broadcastLoading || !broadcast) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-muted-foreground">Loading broadcast...</div>
      </div>
    );
  }

  const progressPercent =
    broadcast.totalRecipients > 0
      ? Math.round((broadcast.sentCount / broadcast.totalRecipients) * 100)
      : 0;

  const showProgress =
    broadcast.status === 'sending' ||
    broadcast.status === 'completed' ||
    broadcast.status === 'paused' ||
    broadcast.status === 'failed';

  const canSend = isDraft && hasTemplate && broadcast.totalRecipients > 0;

  const canCancel =
    broadcast.status === 'scheduled' || broadcast.status === 'sending';

  const canDelete =
    broadcast.status === 'draft' || broadcast.status === 'cancelled';

  const canRetry =
    broadcast.failedCount > 0 &&
    (broadcast.status === 'completed' || broadcast.status === 'failed');

  const templateKey = hasTemplate
    ? `${broadcast.templateName}::${broadcast.templateLanguage}`
    : undefined;

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
      {/* Back link */}
      <div>
        <Link
          to="/campaigns/broadcasts"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          Broadcasts
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* ─── Left column ─────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              {isDraft && editingName !== null ? (
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => {
                    if (editingName && editingName !== broadcast.name) {
                      updateMutation.mutate({ name: editingName });
                    } else {
                      setEditingName(null);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editingName) {
                      updateMutation.mutate({ name: editingName });
                    }
                    if (e.key === 'Escape') setEditingName(null);
                  }}
                  className="text-xl font-bold h-auto py-1 px-2"
                  autoFocus
                />
              ) : (
                <h1
                  className={`text-xl font-bold tracking-tight ${isDraft ? 'cursor-pointer hover:text-muted-foreground transition-colors' : ''}`}
                  role={isDraft ? 'button' : undefined}
                  tabIndex={isDraft ? 0 : undefined}
                  onClick={() => isDraft && setEditingName(broadcast.name)}
                  onKeyDown={(e) => {
                    if (isDraft && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      setEditingName(broadcast.name);
                    }
                  }}
                >
                  {broadcast.name}
                </h1>
              )}
              <div className="flex items-center gap-2">
                <Status variant={broadcastStatusVariant(broadcast.status)}>
                  <StatusIndicator />
                  <StatusLabel>{statusLabel(broadcast.status)}</StatusLabel>
                </Status>
                <span className="text-sm text-muted-foreground">
                  Created <RelativeTimeCard date={broadcast.createdAt} />
                </span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Template section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Template</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isDraft ? (
                <Select
                  value={templateKey}
                  onValueChange={handleTemplateSelect}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {approvedTemplates.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground text-center">
                        No approved templates.{' '}
                        <Link
                          to="/messaging/templates"
                          className="underline hover:text-foreground"
                        >
                          Sync or create templates
                        </Link>{' '}
                        first.
                      </div>
                    ) : (
                      approvedTemplates.map((t) => (
                        <SelectItem
                          key={`${t.name}::${t.language}`}
                          value={`${t.name}::${t.language}`}
                        >
                          {t.name}{' '}
                          <span className="text-muted-foreground">
                            ({t.language})
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-sm">
                  <span className="font-mono font-medium">
                    {broadcast.templateName}
                  </span>
                  <span className="text-muted-foreground ml-1.5">
                    ({broadcast.templateLanguage})
                  </span>
                </div>
              )}
              {selectedTemplate && (
                <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap">
                  {bodyPreview ||
                    getTemplateBodyPreview(selectedTemplate.components)}
                </div>
              )}
              {isDraft && !hasTemplate && (
                <p className="text-sm text-muted-foreground">
                  Select an approved template to continue.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Audience section — CSV or Filter */}
          {isDraft && hasTemplate && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Add Recipients</CardTitle>
                  <div className="flex items-center gap-1 rounded-lg border p-0.5">
                    <Button
                      variant={audienceMode === 'csv' ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => setAudienceMode('csv')}
                    >
                      <UploadIcon className="size-3" />
                      CSV Upload
                    </Button>
                    <Button
                      variant={
                        audienceMode === 'filter' ? 'secondary' : 'ghost'
                      }
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => setAudienceMode('filter')}
                    >
                      <FilterIcon className="size-3" />
                      Filter
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {audienceMode === 'csv' ? (
                  <>
                    <button
                      type="button"
                      className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer hover:border-foreground/30 transition-colors w-full"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <UploadIcon className="size-6 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {csvText
                          ? `CSV loaded (${csvHeaders.length} columns)`
                          : 'Drop a CSV file or click to upload'}
                      </p>
                      <p className="text-xs text-muted-foreground/70">
                        CSV must have a column named phone, phone_number,
                        mobile, or whatsapp
                      </p>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={handleFileChange}
                    />

                    {csvText && (
                      <>
                        {templateVars.length > 0 && (
                          <div className="space-y-3">
                            <Label className="text-sm font-medium">
                              Variable Mapping
                            </Label>
                            {templateVars.map((v) => (
                              <div key={v} className="flex items-center gap-3">
                                <span className="text-sm font-mono w-16 shrink-0">
                                  {v}
                                </span>
                                <Select
                                  value={variableMapping[v] ?? ''}
                                  onValueChange={(col) =>
                                    setVariableMapping((prev) => ({
                                      ...prev,
                                      [v]: col,
                                    }))
                                  }
                                >
                                  <SelectTrigger className="w-48">
                                    <SelectValue placeholder="Select column" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {csvHeaders.map((h) => (
                                      <SelectItem key={h} value={h}>
                                        {h}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-3">
                          <Checkbox
                            id="save-label"
                            checked={saveAsLabel}
                            onCheckedChange={(checked) =>
                              setSaveAsLabel(checked === true)
                            }
                          />
                          <Label
                            htmlFor="save-label"
                            className="text-sm text-muted-foreground cursor-pointer"
                          >
                            Save imported contacts as label
                          </Label>
                          {saveAsLabel && (
                            <Input
                              value={labelName}
                              onChange={(e) => setLabelName(e.target.value)}
                              placeholder="Label name"
                              className="h-8 w-48"
                            />
                          )}
                        </div>

                        <Button
                          size="sm"
                          onClick={handleUploadRecipients}
                          disabled={uploadRecipientsMutation.isPending}
                        >
                          <UploadIcon className="size-3.5 mr-1.5" />
                          {uploadRecipientsMutation.isPending
                            ? 'Uploading...'
                            : 'Upload Recipients'}
                        </Button>
                      </>
                    )}

                    {uploadSummary && (
                      <div className="rounded-md border p-3 text-sm space-y-1">
                        <p>
                          <span className="font-medium">
                            {uploadSummary.created}
                          </span>{' '}
                          added
                          {uploadSummary.skipped > 0 && (
                            <>
                              {' / '}
                              <span className="text-muted-foreground">
                                {uploadSummary.skipped} opted-out
                              </span>
                            </>
                          )}
                          {uploadSummary.invalid > 0 && (
                            <>
                              {' / '}
                              <span className="text-destructive">
                                {uploadSummary.invalid} invalid
                              </span>
                            </>
                          )}
                        </p>
                        {uploadSummary.errors.length > 0 && (
                          <details className="text-xs text-muted-foreground">
                            <summary className="cursor-pointer text-destructive">
                              {uploadSummary.errors.length} error(s)
                            </summary>
                            <ul className="mt-1 space-y-0.5 pl-3 list-disc">
                              {uploadSummary.errors.slice(0, 10).map((err) => (
                                <li key={err}>{err}</li>
                              ))}
                              {uploadSummary.errors.length > 10 && (
                                <li>
                                  ...and {uploadSummary.errors.length - 10} more
                                </li>
                              )}
                            </ul>
                          </details>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  /* ─── Filter Mode ─────────────────────────── */
                  <div className="space-y-4">
                    {/* Role filter */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Filter by role
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {(['customer', 'lead', 'staff'] as const).map(
                          (role) => {
                            const selected =
                              audienceFilter.roles.includes(role);
                            return (
                              <button
                                key={role}
                                type="button"
                                onClick={() =>
                                  setAudienceFilter((prev) => ({
                                    ...prev,
                                    roles: selected
                                      ? prev.roles.filter((r) => r !== role)
                                      : [...prev.roles, role],
                                  }))
                                }
                                className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                                  selected
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'hover:bg-muted'
                                }`}
                              >
                                {role}
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>

                    {/* Label filter */}
                    {allLabels.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">
                          Filter by labels
                        </Label>
                        <div className="flex flex-wrap gap-1.5">
                          {allLabels.map((label) => {
                            const selected = audienceFilter.labelIds.includes(
                              label.id,
                            );
                            return (
                              <button
                                key={label.id}
                                type="button"
                                onClick={() =>
                                  setAudienceFilter((prev) => ({
                                    ...prev,
                                    labelIds: selected
                                      ? prev.labelIds.filter(
                                          (id) => id !== label.id,
                                        )
                                      : [...prev.labelIds, label.id],
                                  }))
                                }
                                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                                  selected
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'hover:bg-muted'
                                }`}
                              >
                                <span
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={{
                                    backgroundColor: label.color ?? '#6b7280',
                                  }}
                                />
                                {label.title}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Attribute filters */}
                    {attrDefs.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">
                          Filter by attributes
                        </Label>
                        {audienceFilter.attributes.map((attr, idx) => (
                          <div
                            key={`attr-${idx.toString()}`}
                            className="flex items-center gap-2"
                          >
                            <Select
                              value={attr.key}
                              onValueChange={(key) =>
                                setAudienceFilter((prev) => ({
                                  ...prev,
                                  attributes: prev.attributes.map((a, i) =>
                                    i === idx ? { ...a, key } : a,
                                  ),
                                }))
                              }
                            >
                              <SelectTrigger className="w-36 h-8">
                                <SelectValue placeholder="Attribute" />
                              </SelectTrigger>
                              <SelectContent>
                                {attrDefs.map((def) => (
                                  <SelectItem key={def.key} value={def.key}>
                                    {def.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              value={attr.value}
                              onChange={(e) =>
                                setAudienceFilter((prev) => ({
                                  ...prev,
                                  attributes: prev.attributes.map((a, i) =>
                                    i === idx
                                      ? { ...a, value: e.target.value }
                                      : a,
                                  ),
                                }))
                              }
                              placeholder="Value"
                              className="h-8 flex-1"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0"
                              onClick={() =>
                                setAudienceFilter((prev) => ({
                                  ...prev,
                                  attributes: prev.attributes.filter(
                                    (_, i) => i !== idx,
                                  ),
                                }))
                              }
                            >
                              <XIcon className="size-3.5" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() =>
                            setAudienceFilter((prev) => ({
                              ...prev,
                              attributes: [
                                ...prev.attributes,
                                {
                                  key: attrDefs[0]?.key ?? '',
                                  value: '',
                                },
                              ],
                            }))
                          }
                        >
                          + Add attribute filter
                        </Button>
                      </div>
                    )}

                    {/* Exclude opted-out */}
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="exclude-opted-out"
                        checked={audienceFilter.excludeOptedOut}
                        onCheckedChange={(checked) =>
                          setAudienceFilter((prev) => ({
                            ...prev,
                            excludeOptedOut: checked === true,
                          }))
                        }
                      />
                      <Label
                        htmlFor="exclude-opted-out"
                        className="text-sm text-muted-foreground cursor-pointer"
                      >
                        Exclude marketing opt-outs
                      </Label>
                    </div>

                    <Separator />

                    {/* Preview results */}
                    {hasActiveFilter && (
                      <div className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <UsersIcon className="size-4 text-muted-foreground" />
                            <span className="text-sm font-medium">
                              {isPreviewFetching
                                ? 'Counting...'
                                : `${audiencePreview?.total ?? 0} contacts match`}
                            </span>
                          </div>
                        </div>
                        {audiencePreview &&
                          audiencePreview.sample.length > 0 && (
                            <div className="text-xs text-muted-foreground space-y-0.5">
                              {audiencePreview.sample.slice(0, 5).map((c) => (
                                <div
                                  key={c.id}
                                  className="flex items-center gap-2"
                                >
                                  <span className="font-medium text-foreground">
                                    {c.name ?? c.phone ?? c.id}
                                  </span>
                                  <span>{c.phone}</span>
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] capitalize"
                                  >
                                    {c.role}
                                  </Badge>
                                </div>
                              ))}
                              {audiencePreview.total > 5 && (
                                <p className="text-muted-foreground/60">
                                  ...and {audiencePreview.total - 5} more
                                </p>
                              )}
                            </div>
                          )}
                      </div>
                    )}

                    {!hasActiveFilter && (
                      <p className="text-sm text-muted-foreground text-center py-2">
                        Select at least one filter to preview matching contacts.
                      </p>
                    )}

                    <Button
                      size="sm"
                      onClick={() =>
                        addFromFilterMutation.mutate(audienceFilter)
                      }
                      disabled={
                        !hasActiveFilter ||
                        addFromFilterMutation.isPending ||
                        isPreviewFetching ||
                        (audiencePreview?.total ?? 0) === 0
                      }
                    >
                      <UsersIcon className="size-3.5 mr-1.5" />
                      {addFromFilterMutation.isPending
                        ? 'Adding...'
                        : `Add ${audiencePreview?.total ?? 0} recipients`}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Recipients section */}
          {recipients.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Recipients ({recipientsData?.total ?? recipients.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Phone</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Variables</TableHead>
                        <TableHead>Sent</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recipients.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-sm">
                            {r.phone}
                          </TableCell>
                          <TableCell>
                            <Status variant={recipientStatusVariant(r.status)}>
                              <StatusIndicator />
                              <StatusLabel>{statusLabel(r.status)}</StatusLabel>
                            </Status>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {r.variables
                              ? Object.values(r.variables).join(', ')
                              : '-'}
                          </TableCell>
                          <TableCell>
                            {r.sentAt ? (
                              <RelativeTimeCard date={r.sentAt} />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ─── Right column (sidebar) ──────────────────────────────── */}
        <div className="space-y-4">
          {/* Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {canSend && (
                <>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="schedule-toggle"
                      checked={scheduleMode}
                      onCheckedChange={setScheduleMode}
                    />
                    <Label
                      htmlFor="schedule-toggle"
                      className="text-sm flex items-center gap-1.5 cursor-pointer"
                    >
                      <CalendarIcon className="size-3.5" />
                      Schedule for later
                    </Label>
                  </div>
                  {scheduleMode && (
                    <div className="space-y-1">
                      <Input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        className="text-sm"
                        min={new Date().toISOString().slice(0, 16)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Your timezone:{' '}
                        {Intl.DateTimeFormat().resolvedOptions().timeZone}
                      </p>
                    </div>
                  )}

                  {scheduleMode ? (
                    <Button
                      className="w-full gap-1.5"
                      onClick={() =>
                        scheduleMutation.mutate({
                          scheduledAt: new Date(scheduledAt).toISOString(),
                          timezone:
                            Intl.DateTimeFormat().resolvedOptions().timeZone,
                        })
                      }
                      disabled={scheduleMutation.isPending || !scheduledAt}
                    >
                      <CalendarIcon className="size-3.5" />
                      {scheduleMutation.isPending
                        ? 'Scheduling...'
                        : 'Schedule Broadcast'}
                    </Button>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button className="w-full gap-1.5">
                          <PlayIcon className="size-3.5" />
                          Send Now
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Send broadcast?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will send the template message to{' '}
                            <span className="font-medium text-foreground">
                              {broadcast.totalRecipients}
                            </span>{' '}
                            recipients. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={handleSendNow}
                            disabled={sendMutation.isPending}
                          >
                            {sendMutation.isPending
                              ? 'Starting...'
                              : 'Send Now'}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </>
              )}

              {isDraft && !hasTemplate && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Select a template to get started.
                </p>
              )}

              {isDraft && hasTemplate && broadcast.totalRecipients === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Upload a CSV to add recipients.
                </p>
              )}

              {broadcast.status === 'scheduled' && broadcast.scheduledAt && (
                <div className="text-sm text-center py-2">
                  <p className="text-muted-foreground">Scheduled for</p>
                  <p className="font-medium">
                    <RelativeTimeCard date={broadcast.scheduledAt} />
                  </p>
                </div>
              )}

              {canCancel && (
                <Button
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                >
                  <SquareIcon className="size-3.5" />
                  {broadcast.status === 'sending' ? 'Pause' : 'Cancel'}
                </Button>
              )}

              {canRetry && (
                <Button
                  variant="outline"
                  className="w-full gap-1.5"
                  onClick={() => retryMutation.mutate()}
                  disabled={retryMutation.isPending}
                >
                  <RotateCcwIcon className="size-3.5" />
                  Retry Failed ({broadcast.failedCount})
                </Button>
              )}

              {canDelete && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full gap-1.5">
                      <TrashIcon className="size-3.5" />
                      Delete Broadcast
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete broadcast?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete this broadcast and all its
                        recipient data.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate()}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </CardContent>
          </Card>

          {/* Progress */}
          {showProgress && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {broadcast.sentCount} / {broadcast.totalRecipients}
                    </span>
                    <span className="font-medium">{progressPercent}%</span>
                  </div>
                  <Progress value={progressPercent} />
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center">
                    <p className="text-2xl font-bold tabular-nums">
                      {broadcast.totalRecipients}
                    </p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold tabular-nums">
                      {broadcast.sentCount}
                    </p>
                    <p className="text-xs text-muted-foreground">Sent</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold tabular-nums">
                      {broadcast.deliveredCount}
                    </p>
                    <p className="text-xs text-muted-foreground">Delivered</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold tabular-nums">
                      {broadcast.readCount}
                    </p>
                    <p className="text-xs text-muted-foreground">Read</p>
                  </div>
                  {broadcast.failedCount > 0 && (
                    <div className="text-center col-span-2">
                      <p className="text-2xl font-bold tabular-nums text-destructive">
                        {broadcast.failedCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/campaigns/broadcasts/$broadcastId')(
  {
    component: BroadcastDetailPage,
  },
);
