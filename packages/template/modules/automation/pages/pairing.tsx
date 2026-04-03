import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
  CopyIcon,
  MonitorIcon,
  PowerOffIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { automationClient } from '@/lib/api-client';
import { formatRelativeTime } from '@/lib/format';

type PairingResult = {
  code: string;
  expiresAt: string;
};

type Session = {
  id: string;
  status: string;
  browserInfo: Record<string, unknown> | null;
  pairedAt: string | null;
  lastHeartbeat: string | null;
  createdAt: string;
};

async function fetchSessions(): Promise<Session[]> {
  const res = await automationClient.sessions.$get();
  if (!res.ok) return [];
  return res.json() as unknown as Promise<Session[]>;
}

function CountdownTimer({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    function update() {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('Expired');
        return;
      }
      const minutes = Math.floor(diff / 60_000);
      const seconds = Math.floor((diff % 60_000) / 1_000);
      setRemaining(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    }
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const isExpired = remaining === 'Expired';

  return (
    <span
      className={`text-xs tabular-nums ${isExpired ? 'text-destructive' : 'text-muted-foreground'}`}
    >
      {isExpired ? 'Expired' : `Expires in ${remaining}`}
    </span>
  );
}

function parseBrowserName(ua: string | undefined): string | null {
  if (!ua) return null;
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera';
  if (ua.includes('Chrome/') && !ua.includes('Edg/')) return 'Chrome';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
  return ua.split(' ').slice(-1)[0] ?? null;
}

function PairingPage() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [pairingResult, setPairingResult] = useState<PairingResult | null>(
    null,
  );

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await automationClient.pairing.generate.$post();
      if (!res.ok) throw new Error('Failed to generate pairing code');
      return res.json() as unknown as Promise<PairingResult>;
    },
    onSuccess: (data) => {
      setPairingResult(data);
      queryClient.invalidateQueries({ queryKey: ['automation-pairing'] });
    },
  });

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['automation-pairing'],
    queryFn: fetchSessions,
    refetchInterval: 10_000,
  });

  const disconnectMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await automationClient.sessions[':id'].disconnect.$post({
        param: { id: sessionId },
      });
      if (!res.ok) throw new Error('Failed to disconnect session');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation-pairing'] });
    },
  });

  async function copyCode() {
    if (!pairingResult) return;
    await navigator.clipboard.writeText(pairingResult.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  }

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://your-app.com';

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold">Pair Browser</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect a browser session to enable automation
        </p>
      </div>

      {/* Generate Code Card */}
      <Card className="gap-2">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Pairing Code</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!pairingResult && !generateMutation.isPending && (
            <p className="text-sm text-muted-foreground">
              Generate a one-time pairing code to connect a browser session.
            </p>
          )}

          {generateMutation.isPending && <Skeleton className="h-16 w-48" />}

          {pairingResult && !generateMutation.isPending && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="font-mono text-3xl font-bold tracking-[0.25em] select-all">
                  {pairingResult.code}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground"
                  onClick={copyCode}
                >
                  <CopyIcon className="size-3.5" />
                  <span className="ml-1.5 text-xs">
                    {copied ? 'Copied' : 'Copy'}
                  </span>
                </Button>
              </div>
              <CountdownTimer expiresAt={pairingResult.expiresAt} />
            </div>
          )}

          {generateMutation.isError && (
            <p className="text-xs text-destructive">
              Failed to generate code. Please try again.
            </p>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="gap-1.5"
            >
              <RefreshCwIcon
                className={`size-3.5 ${generateMutation.isPending ? 'animate-spin' : ''}`}
              />
              {pairingResult ? 'Regenerate' : 'Generate Code'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Setup Instructions */}
      <Card className="gap-2">
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Setup Instructions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                1
              </span>
              <span className="text-muted-foreground leading-5">
                Install the{' '}
                <span className="font-medium text-foreground">
                  TamperMonkey
                </span>{' '}
                browser extension from the Chrome Web Store or Firefox Add-ons
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                2
              </span>
              <span className="text-muted-foreground leading-5">
                Navigate to{' '}
                <a
                  href={`${origin}/api/automation/script.user.js`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground underline underline-offset-2 hover:text-primary"
                >
                  {origin}/api/automation/script.user.js
                </a>{' '}
                in the same browser
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                3
              </span>
              <span className="text-muted-foreground leading-5">
                Click{' '}
                <span className="font-medium text-foreground">Install</span>{' '}
                when TamperMonkey prompts you to install the user script
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                4
              </span>
              <span className="text-muted-foreground leading-5">
                Open the target site (e.g.{' '}
                <span className="font-medium text-foreground">
                  WhatsApp Web
                </span>
                , any automation target)
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                5
              </span>
              <span className="text-muted-foreground leading-5">
                Enter the pairing code above in the floating TamperMonkey panel
                on that page
              </span>
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* Sessions */}
      <Card className="gap-2">
        <CardHeader>
          <div className="flex items-center gap-2">
            <MonitorIcon className="size-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">
              Active Sessions
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {sessionsLoading && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {!sessionsLoading && sessions.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <MonitorIcon className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No active sessions. Pair a browser to get started.
              </p>
            </div>
          )}

          {sessions.length > 0 && (
            <div className="divide-y gap-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {parseBrowserName(
                        session.browserInfo?.userAgent as string | undefined,
                      ) ?? session.id}
                    </p>
                    {session.pairedAt && (
                      <p className="text-xs text-muted-foreground">
                        Paired {formatRelativeTime(session.pairedAt)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={
                        session.status === 'active' ? 'default' : 'secondary'
                      }
                      className="capitalize text-xs"
                    >
                      {session.status}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-muted-foreground hover:text-destructive"
                      disabled={disconnectMutation.isPending}
                      onClick={() => disconnectMutation.mutate(session.id)}
                    >
                      <PowerOffIcon className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export const Route = createFileRoute('/_app/automation/pairing')({
  component: PairingPage,
});
