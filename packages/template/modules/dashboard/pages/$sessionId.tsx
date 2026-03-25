import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  PauseCircleIcon,
  XCircleIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ────────────────────────────────────────────────────────────

interface Session {
  id: string;
  agentId: string | null;
  contactId: string | null;
  channel: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface MemoryMessage {
  id: string;
  role: string;
  content: { type: string; text?: string }[] | string;
  createdAt?: string;
}

interface MessagesResponse {
  messages: MemoryMessage[];
}

// ─── Data ─────────────────────────────────────────────────────────────

async function fetchSession(id: string): Promise<Session> {
  const res = await fetch(`/api/conversations/sessions/${id}`);
  if (!res.ok) throw new Error('Session not found');
  return res.json();
}

async function fetchMessages(id: string): Promise<MessagesResponse> {
  const res = await fetch(`/api/conversations/sessions/${id}/messages`);
  if (!res.ok) return { messages: [] };
  return res.json();
}

async function updateSessionStatus(
  id: string,
  status: 'paused' | 'completed' | 'failed',
): Promise<Session> {
  const res = await fetch(`/api/conversations/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error('Failed to update session');
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractText(content: MemoryMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text ?? '')
      .join('');
  }
  return '';
}

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'outline' | 'success' | 'destructive' {
  if (status === 'active') return 'default';
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'destructive';
  if (status === 'paused') return 'outline';
  return 'secondary';
}

// ─── Page ─────────────────────────────────────────────────────────────

function SessionDetailPage() {
  const { sessionId } = Route.useParams();
  const queryClient = useQueryClient();

  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionError,
  } = useQuery({
    queryKey: ['conversations-sessions', sessionId],
    queryFn: () => fetchSession(sessionId),
  });

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['conversations-messages', sessionId],
    queryFn: () => fetchMessages(sessionId),
    enabled: !!session,
  });

  const updateMutation = useMutation({
    mutationFn: (status: 'paused' | 'completed' | 'failed') =>
      updateSessionStatus(sessionId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['conversations-sessions', sessionId],
      });
      queryClient.invalidateQueries({ queryKey: ['conversations-sessions'] });
    },
  });

  if (sessionLoading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (sessionError || !session) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Session not found.</p>
        <Link
          to="/dashboard"
          className="mt-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Back to dashboard
        </Link>
      </div>
    );
  }

  const messages = messagesData?.messages ?? [];
  const isTerminal =
    session.status === 'completed' || session.status === 'failed';

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          to="/dashboard"
          className="hover:text-foreground transition-colors"
        >
          Dashboard
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5" />
        <span className="text-foreground font-medium font-mono text-xs">
          {session.id}
        </span>
      </div>

      {/* Session header */}
      <div className="flex items-start justify-between gap-4 rounded-md border p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge
              variant={statusVariant(session.status)}
              className="capitalize text-xs"
            >
              {session.status}
            </Badge>
            <span className="text-xs text-muted-foreground capitalize">
              {session.channel}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Agent: {session.agentId ?? 'None'}
          </p>
          <p className="text-xs text-muted-foreground">
            Started: {new Date(session.createdAt).toLocaleString()}
          </p>
        </div>

        {/* Emergency actions */}
        {!isTerminal && (
          <div className="flex items-center gap-2">
            {session.status === 'active' && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate('paused')}
              >
                <PauseCircleIcon className="h-3.5 w-3.5" />
                Pause
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs text-destructive hover:text-destructive"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate('failed')}
            >
              <XCircleIcon className="h-3.5 w-3.5" />
              Kill Session
            </Button>
          </div>
        )}
      </div>

      {/* Transcript */}
      <div>
        <h3 className="mb-3 text-sm font-medium">Transcript</h3>

        {messagesLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-3/4" />
            <Skeleton className="ml-auto h-16 w-3/4" />
            <Skeleton className="h-16 w-3/4" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No messages recorded for this session.
          </p>
        ) : (
          <ScrollArea className="h-[480px] rounded-md border p-4">
            <div className="flex flex-col gap-3">
              {messages.map((msg) => {
                const text = extractText(msg.content);
                const isUser = msg.role === 'user';
                if (!text) return null;

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                        isUser
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground'
                      }`}
                    >
                      <p className="mb-1 text-[10px] font-medium opacity-60 capitalize">
                        {msg.role}
                      </p>
                      <p className="leading-relaxed whitespace-pre-wrap">
                        {text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Alert for failed sessions */}
      {session.status === 'failed' && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <CircleAlertIcon className="h-4 w-4 shrink-0" />
          This session has failed and cannot be resumed.
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/_app/dashboard/$sessionId')({
  component: SessionDetailPage,
});
