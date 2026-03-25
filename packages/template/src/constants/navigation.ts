import {
  Activity,
  BotIcon,
  BrainIcon,
  BuildingIcon,
  CableIcon,
  Contact,
  FileText,
  Globe,
  Home,
  KeyIcon,
  type LucideIcon,
  PaletteIcon,
  ScrollText,
  Search,
  ShieldCheckIcon,
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
        label: 'Overview',
        to: '/',
        icon: Home,
        keywords: ['home', 'overview', 'status'],
      },
      {
        label: 'Sessions',
        to: '/sessions',
        icon: Activity,
        keywords: ['agents', 'sessions', 'monitoring', 'control plane'],
      },
      {
        label: 'Contacts',
        to: '/contacts',
        icon: Contact,
        keywords: ['people', 'customers', 'staff', 'phone', 'directory'],
      },
    ],
  },
  {
    label: 'AI',
    items: [
      {
        label: 'Agents',
        to: '/ai/agents',
        icon: BotIcon,
        keywords: ['ai', 'agents', 'assistant', 'bot', 'llm'],
      },
      {
        label: 'Evals',
        to: '/ai/evals',
        icon: Activity,
        keywords: ['evaluation', 'scoring', 'quality', 'faithfulness'],
      },
      {
        label: 'Guardrails',
        to: '/ai/guardrails',
        icon: ShieldCheckIcon,
        keywords: ['moderation', 'safety', 'content', 'filter'],
      },
      {
        label: 'Memory',
        to: '/ai/memory',
        icon: BrainIcon,
        keywords: ['context', 'recall', 'knowledge', 'memory'],
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
export const shellNavigation = [{ label: 'Overview', to: '/' }] as const;

export const knowledgeBaseNavigation = [
  { label: 'Search', to: '/knowledge-base/search' },
  { label: 'Documents', to: '/knowledge-base/documents' },
  { label: 'Sources', to: '/knowledge-base/sources' },
] as const;

export const systemNavigation = [
  { label: 'Operations', to: '/system/list' },
  { label: 'Audit log', to: '/system/logs' },
] as const;

export const moduleNames = ['System', 'Knowledge Base'];
