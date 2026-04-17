import type { ParameterSchemaT } from '@modules/messaging/lib/parameter-schema';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface ParameterEditorProps {
  schema: ParameterSchemaT;
  values: Record<string, unknown>;
  onSave: (values: Record<string, unknown>) => Promise<void>;
}

const OPERATOR_LABELS: Record<string, string> = {
  eq: '=',
  '!=': '≠',
  '>=': '≥',
  '<=': '≤',
  contains: 'contains',
};

interface StoredAudienceFilter {
  roles?: string[];
  labelIds?: string[];
  attributes?: Array<{ key: string; value: string; op?: string }>;
  excludeOptedOut?: boolean;
}

function isStoredAudienceFilter(v: unknown): v is StoredAudienceFilter {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function AudienceFilterPreview({ value }: { value: unknown }) {
  if (!isStoredAudienceFilter(value)) {
    return (
      <p className="text-muted-foreground rounded-md border bg-muted/40 px-3 py-2 text-sm">
        —
      </p>
    );
  }
  const roles = value.roles ?? [];
  const attributes = value.attributes ?? [];
  const parts: string[] = [];
  if (roles.length > 0) parts.push(`roles: ${roles.join(', ')}`);
  if (value.excludeOptedOut) parts.push('exclude opted-out');

  return (
    <div className="flex flex-col gap-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
      {parts.length > 0 && (
        <p className="text-muted-foreground">{parts.join(' · ')}</p>
      )}
      {attributes.length > 0 ? (
        <ul className="flex flex-col gap-0.5 font-mono text-xs">
          {attributes.map((attr, i) => (
            <li key={`${attr.key}-${i.toString()}`}>
              <span>{attr.key}</span>{' '}
              <span className="text-muted-foreground">
                {OPERATOR_LABELS[attr.op ?? 'eq'] ?? attr.op ?? '='}
              </span>{' '}
              <span>{attr.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        parts.length === 0 && <p className="text-muted-foreground">—</p>
      )}
    </div>
  );
}

export function ParameterEditor({
  schema,
  values,
  onSave,
}: ParameterEditorProps) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({
    ...values,
  }));
  const [saving, setSaving] = useState(false);

  const keys = Object.keys(schema);
  if (keys.length === 0) return null;

  function set(key: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft);
      toast.success('Parameters saved');
    } catch {
      toast.error('Failed to save parameters');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {keys.map((key) => {
        const entry = schema[key];
        const val = draft[key] ?? entry.default;

        if (entry.type === 'boolean') {
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <Label htmlFor={`param-${key}`} className="text-sm font-medium">
                {entry.label}
              </Label>
              <Switch
                id={`param-${key}`}
                checked={Boolean(val)}
                onCheckedChange={(v) => set(key, v)}
              />
            </div>
          );
        }

        if (entry.type === 'select' && entry.options) {
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`param-${key}`} className="text-sm font-medium">
                {entry.label}
              </Label>
              <Select
                value={String(val ?? '')}
                onValueChange={(v) => set(key, v)}
              >
                <SelectTrigger id={`param-${key}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {entry.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        if (entry.type === 'number') {
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`param-${key}`} className="text-sm font-medium">
                {entry.label}
              </Label>
              <Input
                id={`param-${key}`}
                type="number"
                value={String(val ?? '')}
                min={entry.min}
                max={entry.max}
                onChange={(e) => set(key, e.target.valueAsNumber)}
              />
            </div>
          );
        }

        if (entry.type === 'time') {
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`param-${key}`} className="text-sm font-medium">
                {entry.label}
              </Label>
              <Input
                id={`param-${key}`}
                type="time"
                value={String(val ?? '')}
                onChange={(e) => set(key, e.target.value)}
              />
            </div>
          );
        }

        if (entry.type === 'template') {
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <Label className="text-sm font-medium">{entry.label}</Label>
              <p className="text-muted-foreground rounded-md border bg-muted/40 px-3 py-2 text-sm font-mono">
                {val !== undefined && val !== null ? String(val) : '—'}
              </p>
            </div>
          );
        }

        if (entry.type === 'audience-filter') {
          return (
            <div key={key} className="flex flex-col gap-1.5">
              <Label className="text-sm font-medium">{entry.label}</Label>
              <AudienceFilterPreview value={val} />
            </div>
          );
        }

        return (
          <div key={key} className="flex flex-col gap-1.5">
            <Label htmlFor={`param-${key}`} className="text-sm font-medium">
              {entry.label}
            </Label>
            <Input
              id={`param-${key}`}
              value={String(val ?? '')}
              onChange={(e) => set(key, e.target.value)}
            />
          </div>
        );
      })}

      <Button
        size="sm"
        onClick={handleSave}
        disabled={saving}
        className="self-start"
      >
        {saving ? 'Saving…' : 'Save parameters'}
      </Button>
    </div>
  );
}
