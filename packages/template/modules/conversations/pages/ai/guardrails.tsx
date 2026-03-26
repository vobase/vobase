import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronDownIcon, ShieldCheckIcon } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { aiClient } from '@/lib/api-client';
import { GuardrailsLogList } from './-guardrails-log-list';

interface GuardrailRule {
  id: string;
  name: string;
  type: string;
  config: { blocklist: string[]; maxLength: number };
  appliedTo: string;
}

async function fetchConfig(): Promise<{ rules: GuardrailRule[] }> {
  const res = await aiClient.guardrails.config.$get();
  if (!res.ok) throw new Error('Failed to fetch guardrails config');
  return res.json();
}

function ConfigSection() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['guardrails-config'],
    queryFn: fetchConfig,
  });

  const [showBlocklist, setShowBlocklist] = useState(false);

  if (isLoading) {
    return <Skeleton className="h-32 w-full rounded-lg" />;
  }

  if (isError || !data) {
    return (
      <p className="text-sm text-destructive">
        Failed to load guardrail configuration.
      </p>
    );
  }

  const rule = data.rules[0];
  if (!rule) return null;

  const blocklistCount = rule.config.blocklist.length;

  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
              <ShieldCheckIcon className="size-4 text-green-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">{rule.name}</p>
                <Badge
                  variant="outline"
                  className="text-xs text-green-600 border-green-300"
                >
                  Active
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Applied to all AI agents
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-1">
              Max Message Length
            </p>
            <p className="text-sm font-medium">
              {rule.config.maxLength.toLocaleString()} characters
            </p>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Blocklist</p>
                <p className="text-sm font-medium">
                  {blocklistCount === 0
                    ? 'No terms configured'
                    : `${blocklistCount} ${blocklistCount === 1 ? 'term' : 'terms'}`}
                </p>
              </div>
              {blocklistCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => setShowBlocklist(!showBlocklist)}
                >
                  <ChevronDownIcon
                    className={`size-3.5 transition-transform ${showBlocklist ? 'rotate-180' : ''}`}
                  />
                </Button>
              )}
            </div>
            {showBlocklist && blocklistCount > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {rule.config.blocklist.map((term) => (
                  <Badge key={term} variant="secondary" className="text-xs">
                    {term}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GuardrailsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Guardrails</h2>
        <p className="text-sm text-muted-foreground">
          Content moderation rules applied to all AI agent messages
        </p>
      </div>

      <ConfigSection />

      <div>
        <h3 className="text-sm font-medium mb-3">Recent Moderation Events</h3>
        <GuardrailsLogList />
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/conversations/ai/guardrails')({
  component: GuardrailsPage,
});
