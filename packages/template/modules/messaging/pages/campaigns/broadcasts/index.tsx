import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { MegaphoneIcon, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { RelativeTimeCard } from '@/components/ui/relative-time-card';
import { Skeleton } from '@/components/ui/skeleton';
import { Status, StatusIndicator, StatusLabel } from '@/components/ui/status';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { messagingClient } from '@/lib/api-client';

// ─── Types ───────────────────────────────────────────────────────────

interface Broadcast {
  id: string;
  name: string;
  templateName: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  createdAt: string;
}

import { broadcastStatusVariant, statusLabel } from './_lib/helpers';

// ─── Data fetching ───────────────────────────────────────────────────

async function fetchBroadcasts(): Promise<{
  data: Broadcast[];
  total: number;
}> {
  const res = await messagingClient.broadcasts.$get({
    query: { limit: '50', offset: '0' },
  });
  if (!res.ok) throw new Error('Failed to fetch broadcasts');
  return res.json() as Promise<{ data: Broadcast[]; total: number }>;
}

// ─── Page ─────────────────────────────────────────────────────────────

function BroadcastsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['broadcasts'],
    queryFn: fetchBroadcasts,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      // Fetch first available channel instance for draft
      const instancesRes = await messagingClient.instances.$get();
      if (!instancesRes.ok)
        throw new Error('Failed to fetch channel instances');
      const instances = (await instancesRes.json()) as unknown as Array<{
        id: string;
        type: string;
      }>;
      const whatsappInstance = instances.find((i) => i.type === 'whatsapp');
      if (!whatsappInstance) {
        throw new Error(
          'No WhatsApp channel configured. Set up a channel first.',
        );
      }

      const res = await messagingClient.broadcasts.$post(
        {},
        {
          init: {
            body: JSON.stringify({
              name: 'Untitled Broadcast',
              channelInstanceId: whatsappInstance.id,
              templateId: '_placeholder',
              templateName: '_placeholder',
            }),
            headers: { 'Content-Type': 'application/json' },
          },
        },
      );
      if (!res.ok) throw new Error('Failed to create broadcast');
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (broadcast) => {
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
      navigate({
        to: '/messaging/campaigns/broadcasts/$broadcastId',
        params: { broadcastId: broadcast.id },
      });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const broadcasts = data?.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Broadcasts</h2>
          <p className="text-muted-foreground">
            Send WhatsApp template messages to multiple contacts at once.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          <PlusIcon className="size-3.5" />
          New Broadcast
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={`skel-${i.toString()}`} className="h-12 w-full" />
          ))}
        </div>
      ) : broadcasts.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <MegaphoneIcon className="size-8" />
            </EmptyMedia>
            <EmptyTitle>No broadcasts yet</EmptyTitle>
            <EmptyDescription>
              Create a broadcast to send template messages in bulk.
            </EmptyDescription>
          </EmptyHeader>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            <PlusIcon className="size-3.5" />
            Create first broadcast
          </Button>
        </Empty>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Template</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead className="text-right">
                  Sent / Delivered / Failed
                </TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {broadcasts.map((b) => (
                <TableRow key={b.id} className="cursor-pointer">
                  <TableCell>
                    <Link
                      to="/messaging/campaigns/broadcasts/$broadcastId"
                      params={{ broadcastId: b.id }}
                      className="font-medium hover:underline"
                    >
                      {b.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-sm">
                    {b.templateName === '_placeholder' ? (
                      <span className="text-muted-foreground/40 italic font-sans">
                        Not selected
                      </span>
                    ) : (
                      b.templateName
                    )}
                  </TableCell>
                  <TableCell>
                    <Status variant={broadcastStatusVariant(b.status)}>
                      <StatusIndicator />
                      <StatusLabel>{statusLabel(b.status)}</StatusLabel>
                    </Status>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {b.totalRecipients}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {b.sentCount} / {b.deliveredCount} / {b.failedCount}
                  </TableCell>
                  <TableCell>
                    <RelativeTimeCard date={b.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/messaging/campaigns/broadcasts/')({
  component: BroadcastsPage,
});
