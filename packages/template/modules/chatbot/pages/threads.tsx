import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputTextarea,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { SourceCitation } from '@/components/chat/source-citation';
import { TypingIndicator } from '@/components/chat/typing-indicator';
import { ThreadList } from '@/components/chat/thread-list';
import { authClient } from '@/lib/auth-client';
import { CopyIcon, MessageSquare } from 'lucide-react';

interface Thread {
  id: string;
  title: string | null;
  assistantId: string;
  createdAt: string;
}

interface ChatMessage {
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

async function fetchThread(id: string): Promise<Thread & { messages: ChatMessage[] }> {
  const res = await fetch(`/api/chatbot/threads/${id}`);
  if (!res.ok) throw new Error('Failed to fetch thread');
  return res.json();
}

async function fetchAssistants(): Promise<Assistant[]> {
  const res = await fetch('/api/chatbot/assistants');
  if (!res.ok) throw new Error('Failed to fetch assistants');
  return res.json();
}

function parseSources(raw: string | null): Array<{ documentTitle: string; relevanceScore?: number }> {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Array<{ documentTitle: string; relevanceScore?: number }>;
  } catch {
    return [];
  }
}

function ChatbotPage() {
  const queryClient = useQueryClient();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);

  const { data: session } = authClient.useSession();
  const userName = session?.user?.name ?? 'You';

  const { data: threads = [] } = useQuery({ queryKey: ['chatbot-threads'], queryFn: fetchThreads });
  const { data: assistants } = useQuery({ queryKey: ['chatbot-assistants'], queryFn: fetchAssistants });
  const { data: activeThread } = useQuery({
    queryKey: ['chatbot-thread', activeThreadId],
    queryFn: () => fetchThread(activeThreadId!),
    enabled: !!activeThreadId,
  });

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

  async function handleSend(messageText: string) {
    if (!messageText.trim() || !activeThreadId || isStreaming) return;
    setInput('');
    setPendingUserMessage(messageText);
    setIsStreaming(true);
    setStreamingContent('');

    try {
      const res = await fetch(`/api/chatbot/threads/${activeThreadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: messageText }),
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
      setPendingUserMessage(null);
      queryClient.invalidateQueries({ queryKey: ['chatbot-thread', activeThreadId] });
      queryClient.invalidateQueries({ queryKey: ['chatbot-threads'] });
    }
  }

  function handlePromptSubmit(msg: PromptInputMessage) {
    if (msg.text.trim()) {
      handleSend(msg.text);
    }
  }

  const hasAssistants = (assistants?.length ?? 0) > 0;

  return (
    <div className="flex h-full">
      {/* Thread sidebar - 280px */}
      <div className="w-[280px] border-r flex flex-col">
        <ThreadList
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={setActiveThreadId}
          onNewChat={() => createThreadMutation.mutate()}
          isCreating={createThreadMutation.isPending}
          hasAssistants={hasAssistants}
        />
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeThreadId ? (
          <div className="flex-1 flex items-center justify-center">
            <ConversationEmptyState
              icon={<MessageSquare className="size-12" />}
              title={hasAssistants ? 'Start a new conversation' : 'Create an assistant first'}
              description={hasAssistants ? 'Select a thread or start a new chat' : 'You need at least one assistant to start chatting'}
            >
              {hasAssistants ? (
                <Button onClick={() => createThreadMutation.mutate()} disabled={createThreadMutation.isPending} className="mt-4">
                  New chat
                </Button>
              ) : (
                <Button asChild className="mt-4">
                  <Link to="/chatbot/assistants">Create assistant</Link>
                </Button>
              )}
            </ConversationEmptyState>
          </div>
        ) : (
          <>
            <Conversation className="flex-1">
              <ConversationContent className="max-w-2xl mx-auto p-4">
                {activeThread?.messages.map((msg) => {
                  const sources = parseSources(msg.sources);
                  return (
                    <Message key={msg.id} from={msg.role === 'user' ? 'user' : 'assistant'}>
                      <MessageContent>
                        <MessageResponse>{msg.content ?? ''}</MessageResponse>
                        {sources.length > 0 && (
                          <SourceCitation sources={sources} />
                        )}
                      </MessageContent>
                      {msg.role === 'assistant' && (
                        <MessageActions>
                          <MessageAction
                            label="Copy"
                            onClick={() => navigator.clipboard.writeText(msg.content ?? '')}
                          >
                            <CopyIcon className="size-3" />
                          </MessageAction>
                        </MessageActions>
                      )}
                    </Message>
                  );
                })}
                {pendingUserMessage && (
                  <Message from="user">
                    <MessageContent>
                      <MessageResponse>{pendingUserMessage}</MessageResponse>
                    </MessageContent>
                  </Message>
                )}
                {isStreaming && streamingContent && (
                  <Message from="assistant">
                    <MessageContent>
                      <MessageResponse>{streamingContent}</MessageResponse>
                    </MessageContent>
                  </Message>
                )}
                {isStreaming && !streamingContent && <TypingIndicator />}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            <div className="border-t p-4">
              <div className="max-w-2xl mx-auto">
                <PromptInput onSubmit={handlePromptSubmit}>
                  <PromptInputTextarea
                    value={input}
                    onChange={(e) => setInput(e.currentTarget.value)}
                    placeholder="Type a message…"
                    className="pr-12"
                  />
                  <PromptInputSubmit
                    disabled={!input.trim() || isStreaming}
                    className="absolute bottom-1 right-1"
                  />
                </PromptInput>
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
