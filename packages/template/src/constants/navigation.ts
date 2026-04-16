import type { LinkProps } from '@tanstack/react-router';
import {
  Activity,
  BarChart3,
  BotIcon,
  BuildingIcon,
  CableIcon,
  Contact,
  Globe,
  KeyIcon,
  LayoutTemplateIcon,
  type LucideIcon,
  MegaphoneIcon,
  MessageSquareTextIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  RadioIcon,
  ScrollText,
  Search,
  ShieldCheckIcon,
  TagIcon,
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
        title: 'Inbox',
        url: '/messaging/inbox',
        icon: MessageSquareTextIcon,
        keywords: [
          'home',
          'overview',
          'dashboard',
          'status',
          'chat',
          'inbox',
          'conversations',
        ],
      },
      {
        title: 'Channels',
        url: '/messaging/channels',
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
      {
        title: 'Contacts',
        url: '/messaging/contacts',
        icon: Contact,
        keywords: ['people', 'customers', 'staff', 'phone', 'directory'],
      },
      {
        title: 'Broadcasts',
        url: '/messaging/broadcasts',
        icon: MegaphoneIcon,
        keywords: ['broadcast', 'campaign', 'bulk', 'mass', 'whatsapp', 'send'],
      },
      {
        title: 'Templates',
        url: '/messaging/templates',
        icon: LayoutTemplateIcon,
        keywords: ['whatsapp', 'message templates', 'approved', 'hsm'],
      },
      {
        title: 'Labels',
        url: '/messaging/labels',
        icon: TagIcon,
        keywords: ['tags', 'categories', 'organization', 'labels'],
      },
    ],
  },
  {
    title: 'AI',
    items: [
      {
        title: 'Agents',
        url: '/agents',
        icon: BotIcon,
        keywords: [
          'ai',
          'agents',
          'bot',
          'llm',
          'knowledge',
          'documents',
          'kb',
        ],
      },
      {
        title: 'Sources',
        url: '/agents/sources',
        icon: Globe,
        keywords: ['connectors', 'google drive', 'sharepoint', 'crawl', 'sync'],
      },
      {
        title: 'Search',
        url: '/agents/search',
        icon: Search,
        keywords: ['find', 'query', 'semantic', 'rag'],
      },
      {
        title: 'Evals',
        url: '/agents/evals',
        icon: BarChart3,
        keywords: ['evaluation', 'scoring', 'quality', 'faithfulness'],
      },
      {
        title: 'Guardrails',
        url: '/agents/guardrails',
        icon: ShieldCheckIcon,
        keywords: ['moderation', 'safety', 'content', 'filter'],
      },
    ],
  },
  {
    title: 'Automation',
    items: [
      {
        title: 'Tasks',
        url: '/automation/tasks',
        icon: MonitorSmartphoneIcon,
        keywords: [
          'automation',
          'browser',
          'whatsapp',
          'tampermonkey',
          'tasks',
        ],
      },
      {
        title: 'Pairing',
        url: '/automation/pairing',
        icon: CableIcon,
        keywords: ['pair', 'connect', 'browser', 'session', 'tampermonkey'],
      },
    ],
  },
  {
    title: 'System',
    items: [
      {
        title: 'Organization',
        url: '/system/organizations',
        icon: BuildingIcon,
        keywords: ['team', 'members', 'roles', 'workspace', 'org'],
      },
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
    ],
  },
];

/** Sidebar navigation — excludes Settings (settings has its own layout) */
export const sidebarNavGroups: NavGroup[] = navGroups.filter(
  (g) => g.title !== 'Settings',
);
