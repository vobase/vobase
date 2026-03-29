import {
  BotIcon,
  BrainIcon,
  FileSearchIcon,
  LayoutIcon,
  type LucideIcon,
  PhoneIcon,
  SearchIcon,
  UserIcon,
  WrenchIcon,
} from 'lucide-react';

export type ToolVariant = 'default' | 'exploration' | 'action' | 'hidden';

export interface ToolRegistryEntry {
  icon: LucideIcon;
  title: string;
  subtitle?: (input: unknown) => string;
  variant: ToolVariant;
}

/**
 * Declarative tool metadata registry.
 * Unknown tools fall back to WrenchIcon + raw name.
 */
export const toolRegistry: Record<string, ToolRegistryEntry> = {
  send_card: {
    icon: LayoutIcon,
    title: 'Send Card',
    variant: 'action',
  },
  search_knowledge_base: {
    icon: SearchIcon,
    title: 'Search KB',
    subtitle: (input) => {
      const q = (input as Record<string, unknown>)?.query;
      return typeof q === 'string' ? q : '';
    },
    variant: 'exploration',
  },
  get_contact_info: {
    icon: UserIcon,
    title: 'Get Contact',
    variant: 'exploration',
  },
  get_contact_memory: {
    icon: BrainIcon,
    title: 'Recall Memory',
    variant: 'exploration',
  },
  consult_human: {
    icon: PhoneIcon,
    title: 'Consult Staff',
    variant: 'action',
  },
  retrieve_context: {
    icon: FileSearchIcon,
    title: 'Retrieve Context',
    variant: 'exploration',
  },
  agent_handoff: {
    icon: BotIcon,
    title: 'Agent Handoff',
    variant: 'action',
  },
};

const defaultEntry: ToolRegistryEntry = {
  icon: WrenchIcon,
  title: '',
  variant: 'default',
};

/** Get registry entry for a tool, with fallback to WrenchIcon + raw name. */
export function getToolEntry(toolName: string): ToolRegistryEntry {
  return toolRegistry[toolName] ?? { ...defaultEntry, title: toolName };
}

/** Get the variant for a tool (default if not registered). */
export function getToolVariant(toolName: string): ToolVariant {
  return toolRegistry[toolName]?.variant ?? 'default';
}

/**
 * Extract tool name from a normalized part type.
 * e.g. 'tool-search_knowledge_base' → 'search_knowledge_base'
 * e.g. 'dynamic-tool' → uses toolName property
 */
export function getToolNameFromPartType(
  partType: string,
  toolName?: string,
): string | undefined {
  if (partType === 'dynamic-tool') return toolName as string;
  if (partType.startsWith('tool-')) return partType.slice(5);
  return undefined;
}
