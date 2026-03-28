import type { LinkProps } from '@tanstack/react-router';
import {
  Activity,
  BarChart3,
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
  RadioIcon,
  ScrollText,
  Search,
  ShieldCheckIcon,
  UserIcon,
} from 'lucide-react';

type BaseNavItem = {
  title: string;
  badge?: string;
  icon?: LucideIcon;
  /** Extra keywords for Cmd+K search (not displayed, just searchable) */
  keywords?: string[];
};

type NavLink = BaseNavItem & {
  url: LinkProps['to'] | (string & {});
  items?: never;
};

type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & { url: LinkProps['to'] | (string & {}) })[];
  url?: never;
};

type NavItem = NavCollapsible | NavLink;

type NavGroup = {
  title: string;
  items: NavItem[];
};

export type { NavCollapsible, NavGroup, NavItem, NavLink };

export const navGroups: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      {
        title: 'Home',
        url: '/',
        icon: Home,
        keywords: ['home', 'overview', 'dashboard', 'status'],
      },
      {
        title: 'Contacts',
        url: '/contacts',
        icon: Contact,
        keywords: ['people', 'customers', 'staff', 'phone', 'directory'],
      },
      {
        title: 'Channels',
        url: '/channels',
        icon: RadioIcon,
        keywords: [
          'whatsapp',
          'web',
          'email',
          'voice',
          'instances',
          'endpoints',
        ],
      },
    ],
  },
  {
    title: 'AI',
    items: [
      {
        title: 'Agents',
        url: '/ai/agents',
        icon: BotIcon,
        keywords: ['ai', 'agents', 'bot', 'llm'],
      },
      {
        title: 'Evals',
        url: '/ai/evals',
        icon: BarChart3,
        keywords: ['evaluation', 'scoring', 'quality', 'faithfulness'],
      },
      {
        title: 'Guardrails',
        url: '/ai/guardrails',
        icon: ShieldCheckIcon,
        keywords: ['moderation', 'safety', 'content', 'filter'],
      },
      {
        title: 'Memory',
        url: '/ai/memory',
        icon: BrainIcon,
        keywords: ['context', 'recall', 'knowledge', 'memory'],
      },
    ],
  },
  {
    title: 'Knowledge Base',
    items: [
      {
        title: 'Search',
        url: '/knowledge-base/search',
        icon: Search,
        keywords: ['find', 'query', 'semantic', 'rag'],
      },
      {
        title: 'Documents',
        url: '/knowledge-base/documents',
        icon: FileText,
        keywords: ['upload', 'pdf', 'files', 'kb'],
      },
      {
        title: 'Sources',
        url: '/knowledge-base/sources',
        icon: Globe,
        keywords: ['connectors', 'google drive', 'sharepoint', 'crawl', 'sync'],
      },
    ],
  },
  {
    title: 'System',
    items: [
      {
        title: 'Operations',
        url: '/system/list',
        icon: Activity,
        keywords: ['health', 'modules', 'status', 'monitoring'],
      },
      {
        title: 'Audit Log',
        url: '/system/logs',
        icon: ScrollText,
        keywords: ['activity', 'history', 'events', 'logs'],
      },
    ],
  },
  {
    title: 'Settings',
    items: [
      {
        title: 'Profile',
        url: '/settings/profile',
        icon: UserIcon,
        keywords: ['account', 'name', 'email', 'user'],
      },
      {
        title: 'Appearance',
        url: '/settings/appearance',
        icon: PaletteIcon,
        keywords: ['theme', 'dark mode', 'light mode', 'colors'],
      },
      {
        title: 'API Keys',
        url: '/settings/api-keys',
        icon: KeyIcon,
        keywords: ['tokens', 'access', 'mcp', 'authentication'],
      },
      {
        title: 'Integrations',
        url: '/settings/integrations',
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
        title: 'Organization',
        url: '/settings/organization',
        icon: BuildingIcon,
        keywords: ['team', 'members', 'roles', 'workspace'],
      },
    ],
  },
];

/** All nav items flattened — used by command palette and breadcrumbs */
export const allNavItems = navGroups.flatMap((g) =>
  g.items.flatMap((item) =>
    item.items
      ? [item, ...item.items].filter(
          (i): i is BaseNavItem & { url: string } => 'url' in i && !!i.url,
        )
      : [item as BaseNavItem & { url: string }],
  ),
);

/** Sidebar navigation — excludes Settings (settings has its own layout) */
export const sidebarNavGroups: NavGroup[] = navGroups.filter(
  (g) => g.title !== 'Settings',
);
