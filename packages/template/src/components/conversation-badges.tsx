import { Link } from '@tanstack/react-router';
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  GlobeIcon,
  MailIcon,
  MessageSquareIcon,
  MicIcon,
  PauseCircleIcon,
  UserIcon,
  XCircleIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// ─── Shared ──────────────────────────────────────────────────────────

const FIELD_TRIGGER_CLASS =
  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

// ─── Mode ────────────────────────────────────────────────────────────

const MODE_CONFIG = {
  ai: {
    label: 'AI',
    color: 'text-violet-600 dark:text-violet-400',
    Icon: BotIcon,
    iconColor: 'text-violet-500',
    iconFill: undefined,
    iconSize: undefined,
  },
  human: {
    label: 'Human',
    color: 'text-blue-600 dark:text-blue-400',
    Icon: UserIcon,
    iconColor: 'text-blue-500',
    iconFill: undefined,
    iconSize: undefined,
  },
  supervised: {
    label: 'Supervised',
    color: 'text-amber-600 dark:text-amber-400',
    Icon: CircleIcon,
    iconColor: 'text-amber-500',
    iconFill: 'fill-amber-500',
    iconSize: 'h-3 w-3',
  },
  held: {
    label: 'On Hold',
    color: 'text-muted-foreground',
    Icon: PauseCircleIcon,
    iconColor: 'text-muted-foreground',
    iconFill: undefined,
    iconSize: undefined,
  },
} as const;

type ModeValue = keyof typeof MODE_CONFIG;

function getModeConfig(mode: string) {
  return MODE_CONFIG[mode as ModeValue] ?? MODE_CONFIG.held;
}

function ModeIcon({ mode, className }: { mode: string; className?: string }) {
  const cfg = getModeConfig(mode);
  return (
    <cfg.Icon
      className={cn(
        cfg.iconSize ?? 'h-3.5 w-3.5',
        cfg.iconColor,
        cfg.iconFill,
        className,
      )}
    />
  );
}

export function ModeBadge({
  mode,
  variant = 'badge',
  onSelect,
  disabled,
  className,
}: {
  mode: string;
  variant?: 'field' | 'icon' | 'badge' | 'muted';
  onSelect?: (mode: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const cfg = getModeConfig(mode);

  if (variant === 'icon') {
    return <ModeIcon mode={mode} />;
  }

  if (variant === 'field' && onSelect) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button type="button" className={cn(FIELD_TRIGGER_CLASS, cfg.color)}>
            <ModeIcon mode={mode} />
            <span className="font-medium">{cfg.label}</span>
            <ChevronDownIcon className="h-3 w-3 opacity-40" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[140px]">
          {Object.entries(MODE_CONFIG).map(([value, c]) => (
            <DropdownMenuItem
              key={value}
              onClick={() => onSelect(value)}
              className="gap-2 text-sm"
            >
              <c.Icon className={cn('h-3 w-3', c.iconColor, c.iconFill)} />
              {c.label}
              {value === mode && (
                <CheckIcon className="ml-auto h-3.5 w-3.5 text-foreground" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (variant === 'muted') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium text-muted-foreground',
          className,
        )}
      >
        <cfg.Icon
          className={cn(cfg.iconSize ?? 'h-3 w-3', 'text-muted-foreground/60')}
        />
        {cfg.label}
      </span>
    );
  }

  // badge (read-only)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-1.5 py-0.5 text-sm font-medium',
        cfg.color,
        className,
      )}
    >
      <ModeIcon mode={mode} />
      {cfg.label}
    </span>
  );
}

// ─── Priority ────────────────────────────────────────────────────────

const PRIORITY_CONFIG = {
  urgent: { label: 'Urgent', marks: '!!!', color: 'text-red-500' },
  high: { label: 'High', marks: '!!', color: 'text-muted-foreground' },
  normal: { label: 'Normal', marks: '!', color: 'text-muted-foreground' },
  low: { label: 'Low', marks: '·', color: 'text-muted-foreground' },
} as const;

type PriorityValue = keyof typeof PRIORITY_CONFIG;

function getPriorityConfig(priority: string | null) {
  if (!priority) return null;
  return PRIORITY_CONFIG[priority as PriorityValue] ?? null;
}

/** Exclamation-mark indicator for inline use (returns null for low/none). */
export function PriorityIcon({
  priority,
  className,
}: {
  priority: string | null;
  className?: string;
}) {
  const cfg = getPriorityConfig(priority);
  if (!cfg || priority === 'low') return null;

  return (
    <span
      className={cn(
        'text-[10px] font-black leading-none shrink-0',
        cfg.color,
        className,
      )}
    >
      {cfg.marks}
    </span>
  );
}

/** Full priority badge with marks — shows dash for null. */
function PriorityMarks({ priority }: { priority: string | null }) {
  const cfg = getPriorityConfig(priority);
  if (!cfg) {
    return (
      <span className="text-[10px] font-black text-muted-foreground/40">—</span>
    );
  }
  return (
    <span className={cn('text-[10px] font-black', cfg.color)}>{cfg.marks}</span>
  );
}

export function PriorityBadge({
  priority,
  variant = 'badge',
  onSelect,
  disabled,
}: {
  priority: string | null;
  variant?: 'field' | 'icon' | 'badge';
  onSelect?: (priority: string | null) => void;
  disabled?: boolean;
}) {
  const cfg = getPriorityConfig(priority);
  const label = cfg?.label ?? 'No priority';

  if (variant === 'icon') {
    return <PriorityIcon priority={priority} />;
  }

  if (variant === 'field' && onSelect) {
    const options = [
      { value: null, label: 'No priority' },
      ...Object.entries(PRIORITY_CONFIG).map(([value, c]) => ({
        value,
        label: c.label,
      })),
    ];

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button type="button" className={cn(FIELD_TRIGGER_CLASS)}>
            <PriorityMarks priority={priority} />
            <span className="font-medium">{label}</span>
            <ChevronDownIcon className="h-3 w-3 opacity-40" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[140px]">
          {options.map((opt) => (
            <DropdownMenuItem
              key={opt.value ?? '_none'}
              onClick={() => onSelect(opt.value)}
              className="gap-2 text-sm"
            >
              <PriorityMarks priority={opt.value} />
              {opt.label}
              {opt.value === priority && (
                <CheckIcon className="ml-auto h-3.5 w-3.5 text-foreground" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // badge (read-only)
  if (!cfg) return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-sm text-muted-foreground">
      <PriorityMarks priority={priority} />
      {label}
    </span>
  );
}

// ─── Status ──────────────────────────────────────────────────────────

const STATUS_VARIANT_MAP: Record<
  string,
  'default' | 'success' | 'destructive' | 'secondary'
> = {
  active: 'default',
  completed: 'success',
  failed: 'destructive',
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <Badge
      variant={STATUS_VARIANT_MAP[status] ?? 'secondary'}
      className={cn('text-xs capitalize h-5 px-1.5', className)}
    >
      {status}
    </Badge>
  );
}

// ─── Channel ─────────────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<
  string,
  { label: string; Icon: typeof GlobeIcon }
> = {
  whatsapp: { label: 'WhatsApp', Icon: MessageSquareIcon },
  web: { label: 'Web Chat', Icon: GlobeIcon },
  email: { label: 'Email', Icon: MailIcon },
  voice: { label: 'Voice', Icon: MicIcon },
};

function getChannelConfig(type: string) {
  return (
    CHANNEL_CONFIG[type] ?? {
      label: type.charAt(0).toUpperCase() + type.slice(1),
      Icon: GlobeIcon,
    }
  );
}

export function ChannelBadge({
  type,
  variant = 'badge',
  className,
}: {
  type: string | null;
  variant?: 'icon' | 'badge';
  className?: string;
}) {
  if (!type) return null;
  const cfg = getChannelConfig(type);

  if (variant === 'icon') {
    return (
      <span
        className={cn(
          'inline-flex items-center text-muted-foreground/70',
          className,
        )}
      >
        <cfg.Icon className="h-2.5 w-2.5" />
      </span>
    );
  }

  // badge
  return (
    <Badge
      variant="outline"
      className={cn('text-xs font-normal h-5 border-dashed', className)}
    >
      <cfg.Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </Badge>
  );
}

// ─── Assignee ────────────────────────────────────────────────────────

export function AssigneeBadge({
  assignee,
  isMe,
  variant = 'badge',
  onAssign,
  onUnassign,
  disabled,
}: {
  assignee: string | null;
  isMe?: boolean;
  variant?: 'field' | 'badge';
  onAssign?: () => void;
  onUnassign?: () => void;
  disabled?: boolean;
}) {
  const label = assignee ? (isMe ? 'You' : 'Staff') : null;

  if (variant === 'field') {
    if (assignee) {
      return (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted group"
          onClick={onUnassign}
          disabled={disabled}
          title="Click to unassign"
        >
          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <UserIcon className="h-2.5 w-2.5" />
          </div>
          <span className="font-medium">{label}</span>
          <XCircleIcon className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </button>
      );
    }

    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={onAssign}
        disabled={disabled}
      >
        <div className="flex h-4 w-4 items-center justify-center rounded-full border border-dashed border-muted-foreground/50">
          <UserIcon className="h-2.5 w-2.5" />
        </div>
        Assign to me
      </button>
    );
  }

  // badge (read-only)
  if (!assignee) return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-sm text-muted-foreground">
      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-muted">
        <UserIcon className="h-2.5 w-2.5" />
      </div>
      {label}
    </span>
  );
}

// ─── Contact ─────────────────────────────────────────────────────────

export function ContactBadge({
  name,
  contactId,
  variant = 'badge',
  className,
}: {
  name: string | null;
  contactId: string | null;
  variant?: 'badge' | 'link';
  className?: string;
}) {
  const display = name ?? contactId ?? 'Unknown';

  if (variant === 'link' && contactId) {
    return (
      <Link
        to="/contacts/$contactId"
        params={{ contactId }}
        className={cn(
          'inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline',
          className,
        )}
      >
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10">
          <UserIcon className="h-3 w-3 text-primary" />
        </div>
        {display}
      </Link>
    );
  }

  // badge (read-only text)
  return (
    <span
      className={cn('text-sm font-medium text-foreground truncate', className)}
    >
      {display}
    </span>
  );
}

// ─── Resolution outcome ──────────────────────────────────────────────

export function ResolutionBadge({ outcome }: { outcome: string | null }) {
  if (!outcome) return null;
  return (
    <span className="text-xs text-muted-foreground capitalize">
      {outcome.replaceAll('_', ' ')}
    </span>
  );
}
