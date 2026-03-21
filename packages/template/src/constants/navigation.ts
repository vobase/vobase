import {
  Activity,
  Bot,
  BrainCircuit,
  BuildingIcon,
  CableIcon,
  ChartBar,
  Contact,
  FileText,
  GitBranch,
  Globe,
  Home,
  KeyIcon,
  type LucideIcon,
  MessageSquare,
  PaletteIcon,
  ScrollText,
  Search,
  Shield,
  UserIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Extra keywords for Cmd+K search (not displayed, just searchable) */
  keywords?: string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navigation: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        label: 'Dashboard',
        to: '/',
        icon: Home,
        keywords: ['home', 'overview', 'status'],
      },
    ],
  },
  {
    label: 'Messaging',
    items: [
      {
        label: 'Chat',
        to: '/messaging/threads',
        icon: MessageSquare,
        keywords: [
          'messaging',
          'threads',
          'conversations',
          'whatsapp',
          'messages',
        ],
      },
      {
        label: 'Contacts',
        to: '/messaging/contacts',
        icon: Contact,
        keywords: ['people', 'customers', 'phone', 'directory'],
      },
    ],
  },
  {
    label: 'Knowledge Base',
    items: [
      {
        label: 'Search',
        to: '/knowledge-base/search',
        icon: Search,
        keywords: ['find', 'query', 'semantic', 'rag'],
      },
      {
        label: 'Documents',
        to: '/knowledge-base/documents',
        icon: FileText,
        keywords: ['upload', 'pdf', 'files', 'kb'],
      },
      {
        label: 'Sources',
        to: '/knowledge-base/sources',
        icon: Globe,
        keywords: ['connectors', 'google drive', 'sharepoint', 'crawl', 'sync'],
      },
    ],
  },
  {
    label: 'AI',
    items: [
      {
        label: 'Agents',
        to: '/ai/agents',
        icon: Bot,
        keywords: ['ai', 'assistant', 'bot', 'prompt', 'model'],
      },
      {
        label: 'Evals',
        to: '/ai/evals',
        icon: ChartBar,
        keywords: ['evaluation', 'scoring', 'quality', 'faithfulness', 'relevancy'],
      },
      {
        label: 'Workflows',
        to: '/ai/workflows',
        icon: GitBranch,
        keywords: ['escalation', 'follow-up', 'hitl', 'automation', 'suspend', 'resume'],
      },
      {
        label: 'Guardrails',
        to: '/ai/guardrails',
        icon: Shield,
        keywords: ['moderation', 'content', 'safety', 'blocklist'],
      },
      {
        label: 'Memory',
        to: '/ai/memory',
        icon: BrainCircuit,
        keywords: ['episodes', 'facts', 'cells', 'retrieval', 'context'],
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        label: 'Operations',
        to: '/system/list',
        icon: Activity,
        keywords: ['health', 'modules', 'status', 'monitoring'],
      },
      {
        label: 'Audit Log',
        to: '/system/logs',
        icon: ScrollText,
        keywords: ['activity', 'history', 'events', 'logs'],
      },
    ],
  },
  {
    label: 'Settings',
    items: [
      {
        label: 'Profile',
        to: '/settings/profile',
        icon: UserIcon,
        keywords: ['account', 'name', 'email', 'user'],
      },
      {
        label: 'Appearance',
        to: '/settings/appearance',
        icon: PaletteIcon,
        keywords: ['theme', 'dark mode', 'light mode', 'colors'],
      },
      {
        label: 'API Keys',
        to: '/settings/api-keys',
        icon: KeyIcon,
        keywords: ['tokens', 'access', 'mcp', 'authentication'],
      },
      {
        label: 'Integrations',
        to: '/settings/integrations',
        icon: CableIcon,
        keywords: [
          'whatsapp',
          'email',
          'connect',
          'channels',
          'resend',
          'smtp',
        ],
      },
      {
        label: 'Organization',
        to: '/settings/organization',
        icon: BuildingIcon,
        keywords: ['team', 'members', 'roles', 'workspace'],
      },
    ],
  },
];

/** All nav items including settings — used by command palette (Cmd+K) */
export const allNavItems: NavItem[] = navigation.flatMap((g) => g.items);

/** Sidebar navigation — excludes Settings (settings has its own layout) */
export const sidebarNavigation: NavGroup[] = navigation.filter(
  (g) => g.label !== 'Settings',
);

// Backward-compatible exports
export const shellNavigation = [{ label: 'Dashboard', to: '/' }] as const;

export const messagingNavigation = [
  { label: 'Chat', to: '/messaging/threads' },
  { label: 'Contacts', to: '/messaging/contacts' },
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

export const moduleNames = ['System', 'Messaging', 'Knowledge Base', 'AI'];
