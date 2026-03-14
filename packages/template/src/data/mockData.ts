import {
  Activity,
  Bot,
  FileText,
  Globe,
  Home,
  MessageSquare,
  ScrollText,
  Search,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const navigation: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', to: '/', icon: Home }],
  },
  {
    label: 'Chatbot',
    items: [
      { label: 'Chat', to: '/chatbot/threads', icon: MessageSquare },
      { label: 'Assistants', to: '/chatbot/assistants', icon: Bot },
    ],
  },
  {
    label: 'Knowledge Base',
    items: [
      { label: 'Search', to: '/knowledge-base/search', icon: Search },
      { label: 'Documents', to: '/knowledge-base/documents', icon: FileText },
      { label: 'Sources', to: '/knowledge-base/sources', icon: Globe },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Operations', to: '/system/list', icon: Activity },
      { label: 'Audit Log', to: '/system/logs', icon: ScrollText },
    ],
  },
]

export const allNavItems: NavItem[] = navigation.flatMap((g) => g.items)

// Backward-compatible exports
export const shellNavigation = [{ label: 'Dashboard', to: '/' }] as const

export const chatbotNavigation = [
  { label: 'Chat', to: '/chatbot/threads' },
  { label: 'Assistants', to: '/chatbot/assistants' },
] as const

export const knowledgeBaseNavigation = [
  { label: 'Search', to: '/knowledge-base/search' },
  { label: 'Documents', to: '/knowledge-base/documents' },
  { label: 'Sources', to: '/knowledge-base/sources' },
] as const

export const systemNavigation = [
  { label: 'Operations', to: '/system/list' },
  { label: 'Audit log', to: '/system/logs' },
] as const

export const moduleNames = ['System', 'Chatbot', 'Knowledge Base']
