import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';

import {
  Conversation,
  ConversationContent,
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
import { BookOpenIcon, CodeIcon, CopyIcon, LightbulbIcon, MessageSquare, SearchIcon } from 'lucide-react';

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
  suggestions: string | null;
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

  const defaultSuggestions = [
    { icon: CodeIcon, label: 'Write code', prompt: 'Help me write a function that' },
    { icon: SearchIcon, label: 'Search knowledge base', prompt: 'Search the knowledge base for' },
    { icon: BookOpenIcon, label: 'Explain a concept', prompt: 'Explain how' },
    { icon: LightbulbIcon, label: 'Brainstorm ideas', prompt: 'Give me ideas for' },
  ];

  function getAssistantSuggestions(assistantId?: string) {
    const assistant = assistants?.find(a => a.id === assistantId);
    if (!assistant?.suggestions) return defaultSuggestions;
    try {
      const parsed = JSON.parse(assistant.suggestions) as string[];
      if (parsed.length === 0) return defaultSuggestions;
      const icons = [CodeIcon, SearchIcon, BookOpenIcon, LightbulbIcon];
      return parsed.map((prompt, i) => ({
        icon: icons[i % icons.length],
        label: prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt,
        prompt,
      }));
    } catch { return defaultSuggestions; }
  }

  async function handleWelcomeSend(text: string) {
    if (!text.trim() || !hasAssistants) return;
    // Auto-create a thread, then send the message
    const assistantId = assistants![0].id;
    const res = await fetch('/api/chatbot/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assistantId }),
    });
    if (!res.ok) return;
    const thread = await res.json() as Thread;
    queryClient.invalidateQueries({ queryKey: ['chatbot-threads'] });
    setActiveThreadId(thread.id);
    // Send the message after a tick so activeThreadId is set
    setTimeout(() => handleSend(text), 50);
  }

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
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <div className="w-full max-w-xl space-y-8 -mt-12">
              {/* Greeting */}
              <div className="space-y-2 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  {hasAssistants ? 'What can I help you with?' : 'Create an assistant to get started'}
                </h1>
                {!hasAssistants && (
                  <p className="text-sm text-muted-foreground">
                    You need at least one assistant before you can start chatting.
                  </p>
                )}
              </div>

              {/* Suggestion cards */}
              {hasAssistants && (
                <div className="grid grid-cols-2 gap-2">
                  {getAssistantSuggestions().map((suggestion) => (
                    <button
                      key={suggestion.label}
                      type="button"
                      onClick={() => handleWelcomeSend(suggestion.prompt)}
                      className="flex items-center gap-3 rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <suggestion.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span>{suggestion.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Input box */}
              {hasAssistants ? (
                <PromptInput onSubmit={(msg) => handleWelcomeSend(msg.text)} className="w-full">
                  <PromptInputTextarea
                    value={input}
                    onChange={(e) => setInput(e.currentTarget.value)}
                    placeholder="Ask anything..."
                    className="pr-12"
                  />
                  <PromptInputSubmit
                    disabled={!input.trim()}
                    className="absolute bottom-1 right-1"
                  />
                </PromptInput>
              ) : (
                <div className="flex justify-center">
                  <Button asChild>
                    <Link to="/chatbot/assistants">Create assistant</Link>
                  </Button>
                </div>
              )}

              <p className="text-center text-xs text-muted-foreground">
                AI can make mistakes. Verify important information.
              </p>
            </div>
          </div>
        ) : (activeThread?.messages.length === 0 && !pendingUserMessage && !isStreaming) ? (
          /* Empty thread — show suggestions for this assistant */
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <div className="w-full max-w-xl space-y-8 -mt-12">
              <div className="space-y-2 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  What can I help you with?
                </h1>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {getAssistantSuggestions(activeThread?.assistantId).map((suggestion) => (
                  <button
                    key={suggestion.prompt}
                    type="button"
                    onClick={() => handleSend(suggestion.prompt)}
                    className="flex items-center gap-3 rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <suggestion.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>{suggestion.label}</span>
                  </button>
                ))}
              </div>
              <PromptInput onSubmit={handlePromptSubmit} className="w-full">
                <PromptInputTextarea
                  value={input}
                  onChange={(e) => setInput(e.currentTarget.value)}
                  placeholder="Ask anything..."
                  className="pr-12"
                />
                <PromptInputSubmit
                  disabled={!input.trim()}
                  className="absolute bottom-1 right-1"
                />
              </PromptInput>
              <p className="text-center text-xs text-muted-foreground">
                AI can make mistakes. Verify important information.
              </p>
            </div>
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
