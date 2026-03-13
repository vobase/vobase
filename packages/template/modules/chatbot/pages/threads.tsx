import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

interface Thread {
  id: string;
  title: string | null;
  assistantId: string;
  createdAt: string;
}

interface Message {
  id: string;
  threadId: string;
  role: string;
  content: string | null;
  sources: string | null;
  toolCalls: string | null;
  createdAt: string;
}

interface Assistant {
  id: string;
  name: string;
  model: string | null;
}

async function fetchThreads(): Promise<Thread[]> {
  const res = await fetch('/api/chatbot/threads');
  if (!res.ok) throw new Error('Failed to fetch threads');
  return res.json();
}

async function fetchThread(id: string): Promise<Thread & { messages: Message[] }> {
  const res = await fetch(`/api/chatbot/threads/${id}`);
  if (!res.ok) throw new Error('Failed to fetch thread');
  return res.json();
}

async function fetchAssistants(): Promise<Assistant[]> {
  const res = await fetch('/api/chatbot/assistants');
  if (!res.ok) throw new Error('Failed to fetch assistants');
  return res.json();
}

function ChatbotPage() {
  const queryClient = useQueryClient();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: threads } = useQuery({ queryKey: ['chatbot-threads'], queryFn: fetchThreads });
  const { data: assistants } = useQuery({ queryKey: ['chatbot-assistants'], queryFn: fetchAssistants });
  const { data: activeThread } = useQuery({
    queryKey: ['chatbot-thread', activeThreadId],
    queryFn: () => fetchThread(activeThreadId!),
    enabled: !!activeThreadId,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeThread?.messages, streamingContent]);

  const createThreadMutation = useMutation({
    mutationFn: async () => {
      const assistantId = assistants?.[0]?.id;
      if (!assistantId) throw new Error('No assistants available. Create one first.');
      const res = await fetch('/api/chatbot/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantId }),
      });
      if (!res.ok) throw new Error('Failed to create thread');
      return res.json() as Promise<Thread>;
    },
    onSuccess: (thread) => {
      queryClient.invalidateQueries({ queryKey: ['chatbot-threads'] });
      setActiveThreadId(thread.id);
    },
  });

  async function handleSend() {
    if (!input.trim() || !activeThreadId || isStreaming) return;
    const message = input;
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');

    try {
      const res = await fetch(`/api/chatbot/threads/${activeThreadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message }),
      });

      if (!res.ok) throw new Error('Send failed');

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setStreamingContent(accumulated);
        }
      }
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
      queryClient.invalidateQueries({ queryKey: ['chatbot-thread', activeThreadId] });
      queryClient.invalidateQueries({ queryKey: ['chatbot-threads'] });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex h-full">
      {/* Thread sidebar */}
      <div className="w-64 border-r flex flex-col">
        <div className="p-3">
          <Button
            className="w-full"
            size="sm"
            onClick={() => createThreadMutation.mutate()}
            disabled={createThreadMutation.isPending || !assistants?.length}
          >
            New chat
          </Button>
        </div>
        <Separator />
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {threads?.map((thread) => (
              <button
                key={thread.id}
                onClick={() => setActiveThreadId(thread.id)}
                className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                  activeThreadId === thread.id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                }`}
              >
                {thread.title ?? 'New chat'}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        {!activeThreadId ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h3 className="text-lg font-medium mb-1">Chatbot</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {assistants?.length ? 'Start a new conversation' : 'Create an assistant first'}
              </p>
              {assistants?.length ? (
                <Button onClick={() => createThreadMutation.mutate()}>New chat</Button>
              ) : (
                <Button asChild>
                  <Link to="/chatbot/assistants">Create assistant</Link>
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="max-w-2xl mx-auto space-y-4">
                {activeThread?.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`rounded-lg px-4 py-2 max-w-[80%] text-sm ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      {msg.content}
                      {msg.sources && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <p className="text-xs font-medium mb-1">Sources:</p>
                          {(JSON.parse(msg.sources) as Array<{ documentTitle: string }>).map((s, i) => (
                            <p key={i} className="text-xs opacity-70">{s.documentTitle}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {streamingContent && (
                  <div className="flex justify-start">
                    <div className="rounded-lg px-4 py-2 max-w-[80%] text-sm bg-muted">
                      {streamingContent}
                    </div>
                  </div>
                )}
                {isStreaming && !streamingContent && (
                  <div className="flex justify-start">
                    <div className="rounded-lg px-4 py-2 bg-muted">
                      <div className="flex gap-1">
                        <div className="w-2 h-2 rounded-full bg-foreground/30 animate-pulse" />
                        <div className="w-2 h-2 rounded-full bg-foreground/30 animate-pulse [animation-delay:150ms]" />
                        <div className="w-2 h-2 rounded-full bg-foreground/30 animate-pulse [animation-delay:300ms]" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="border-t p-4">
              <div className="max-w-2xl mx-auto flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  className="min-h-[44px] max-h-[200px] resize-none"
                  rows={1}
                />
                <Button onClick={handleSend} disabled={!input.trim() || isStreaming}>
                  Send
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/chatbot/threads')({
  component: ChatbotPage,
});
