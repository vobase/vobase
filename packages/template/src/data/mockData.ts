export const shellNavigation = [
  { label: 'Dashboard', to: '/' },
] as const;

export const chatbotNavigation = [
  { label: 'Chat', to: '/chatbot/threads' },
  { label: 'Assistants', to: '/chatbot/assistants' },
] as const;

export const knowledgeBaseNavigation = [
  { label: 'Search', to: '/knowledge-base/search' },
  { label: 'Documents', to: '/knowledge-base/documents' },
  { label: 'Sources', to: '/knowledge-base/sources' },
] as const;

export const systemNavigation = [
  { label: 'Operations', to: '/system/list' },
  { label: 'Audit log', to: '/system/logs' },
] as const;

export const moduleNames = ['System', 'Chatbot', 'Knowledge Base'];
