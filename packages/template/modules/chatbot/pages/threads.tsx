import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ThreadList } from '@/components/chat/thread-list';
import { BookOpenIcon, CodeIcon, CopyIcon, LightbulbIcon, MessageSquare, SearchIcon } from 'lucide-react';
import { toast } from 'sonner';

interface Thread {
  id: string;
  title: string | null;
  assistantId: string;
  createdAt: string;
}

interface DbMessage {
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

async function fetchThread(id: string): Promise<Thread & { messages: DbMessage[] }> {
  const res = await fetch(`/api/chatbot/threads/${id}`);
  if (!res.ok) throw new Error('Failed to fetch thread');
  return res.json();
}

async function fetchAssistants(): Promise<Assistant[]> {
  const res = await fetch('/api/chatbot/assistants');
  if (!res.ok) throw new Error('Failed to fetch assistants');
  return res.json();
}

/** Convert DB messages to UIMessage format for useChat initialization */
function toUIMessages(dbMessages: DbMessage[]): UIMessage[] {
  return dbMessages.map((msg) => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    parts: [{ type: 'text' as const, text: msg.content ?? '' }],
    createdAt: new Date(msg.createdAt),
  }));
}

/** Chat view for an active thread — uses useChat for streaming */
function ThreadChat({ threadId, initialMessages, autoSendMessage }: { threadId: string; initialMessages: UIMessage[]; autoSendMessage?: string }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [autoSent, setAutoSent] = useState(false);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: `/api/chatbot/threads/${threadId}/chat` }),
    [threadId],
  );

  const { messages, sendMessage, status } = useChat({
    id: threadId,
    transport,
    messages: initialMessages,
    onError: (error) => {
      toast.error(error.message || 'Failed to send message. Check your API key and model configuration.');
    },
    onFinish: () => {
      queryClient.invalidateQueries({ queryKey: ['chatbot-threads'] });
      queryClient.invalidateQueries({ queryKey: ['chatbot-thread', threadId] });
    },
  });

  // Auto-send the welcome message when thread is first created from a suggestion
  if (autoSendMessage && !autoSent && initialMessages.length === 0) {
    setAutoSent(true);
    sendMessage({ text: autoSendMessage });
  }

  function handleSubmit(msg: PromptInputMessage) {
    if (!msg.text.trim()) return;
    sendMessage({ text: msg.text });
    setInput('');
  }

  const isStreaming = status === 'streaming' || status === 'submitted';

  return (
    <>
      <Conversation className="flex-1">
        <ConversationContent className="max-w-2xl mx-auto p-4">
          {messages.map((msg) => (
            <Message key={msg.id} from={msg.role}>
              <MessageContent>
                {msg.parts.map((part, i) => {
                  if (part.type === 'text') {
                    return <MessageResponse key={`${msg.id}-${i}`}>{part.text}</MessageResponse>;
                  }
                  return null;
                })}
              </MessageContent>
              {msg.role === 'assistant' && (
                <MessageActions>
                  <MessageAction
                    label="Copy"
                    onClick={() => {
                      const text = msg.parts.filter(p => p.type === 'text').map(p => (p as any).text).join('');
                      navigator.clipboard.writeText(text);
                    }}
                  >
                    <CopyIcon className="size-3" />
                  </MessageAction>
                </MessageActions>
              )}
            </Message>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-4">
        <div className="max-w-2xl mx-auto">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Type a message…"
              className="pr-12"
            />
            <PromptInputSubmit
              disabled={!input.trim() || isStreaming}
              status={isStreaming ? 'streaming' : 'ready'}
              className="absolute bottom-1 right-1"
            />
          </PromptInput>
        </div>
      </div>
    </>
  );
}

function ChatbotPage() {
  const queryClient = useQueryClient();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(null);
  const [welcomeInput, setWelcomeInput] = useState('');

  const { data: allThreads = [] } = useQuery({ queryKey: ['chatbot-threads'], queryFn: fetchThreads });
  const threads = allThreads.filter(t => t.title);
  const { data: assistants } = useQuery({ queryKey: ['chatbot-assistants'], queryFn: fetchAssistants });
  const { data: activeThread } = useQuery({
    queryKey: ['chatbot-thread', activeThreadId],
    queryFn: () => fetchThread(activeThreadId!),
    enabled: !!activeThreadId,
  });

  const activeAssistantId = selectedAssistantId ?? assistants?.[0]?.id ?? null;
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
    if (!text.trim() || !activeAssistantId) return;
    const res = await fetch('/api/chatbot/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assistantId: activeAssistantId }),
    });
    if (!res.ok) {
      toast.error('Failed to create thread');
      return;
    }
    const thread = await res.json() as Thread;
    queryClient.invalidateQueries({ queryKey: ['chatbot-threads'] });
    setActiveThreadId(thread.id);
    setWelcomeInput(text);
  }

  // Convert DB messages to UIMessage[] for the chat component
  const initialMessages = useMemo(() => {
    const dbMsgs = activeThread?.messages ?? [];
    const uiMsgs = toUIMessages(dbMsgs);
    // If we have a pending welcome message, add it so useChat sends it
    if (welcomeInput && uiMsgs.length === 0) {
      // Don't add — let the chat component send it via sendMessage after mount
    }
    return uiMsgs;
  }, [activeThread?.messages, welcomeInput]);

  // Welcome screen
  const renderWelcome = () => (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-xl space-y-8 -mt-12">
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

        {hasAssistants && (assistants?.length ?? 0) > 1 && (
          <div className="flex justify-center">
            <Select value={activeAssistantId ?? ''} onValueChange={setSelectedAssistantId}>
              <SelectTrigger className="w-auto gap-2">
                <SelectValue placeholder="Select assistant" />
              </SelectTrigger>
              <SelectContent>
                {assistants!.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {hasAssistants && (
          <div className="grid grid-cols-2 gap-2">
            {getAssistantSuggestions(activeAssistantId ?? undefined).map((suggestion) => (
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

        {hasAssistants ? (
          <PromptInput onSubmit={(msg) => handleWelcomeSend(msg.text)} className="w-full">
            <PromptInputTextarea
              value={welcomeInput}
              onChange={(e) => setWelcomeInput(e.currentTarget.value)}
              placeholder="Ask anything..."
              className="pr-12"
            />
            <PromptInputSubmit
              disabled={!welcomeInput.trim()}
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
  );

  return (
    <div className="flex h-full">
      <div className="w-[280px] border-r flex flex-col">
        <ThreadList
          threads={threads}
          activeThreadId={activeThreadId}
          onSelectThread={(id) => { setActiveThreadId(id); setWelcomeInput(''); }}
          onNewChat={() => { setActiveThreadId(null); setWelcomeInput(''); }}
          hasAssistants={hasAssistants}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {!activeThreadId ? (
          renderWelcome()
        ) : !activeThread ? (
          // Loading thread data
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        ) : (
          <ThreadChat
            key={activeThreadId}
            threadId={activeThreadId}
            initialMessages={initialMessages}
            autoSendMessage={welcomeInput || undefined}
          />
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/chatbot/threads')({
  component: ChatbotPage,
});
