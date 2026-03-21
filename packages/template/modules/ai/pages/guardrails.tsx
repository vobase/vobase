import { createFileRoute } from '@tanstack/react-router';

import { Badge } from '@/components/ui/badge';

function GuardrailsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Guardrails</h2>
          <p className="text-sm text-muted-foreground">
            Content moderation runs on every agent message — no LLM cost, pure
            text matching
          </p>
        </div>
      </div>
      <div className="rounded-lg border bg-card p-6">
        <h3 className="font-medium text-sm mb-1">Content Moderation</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Input processor that checks messages against a blocklist before the
          agent sees them. Applied unconditionally to all agents (chat and
          channel replies).
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Blocklist matching</Badge>
          <Badge variant="secondary">Max length enforcement</Badge>
          <Badge variant="secondary">Always-on</Badge>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/ai/guardrails')({
  component: GuardrailsPage,
});
