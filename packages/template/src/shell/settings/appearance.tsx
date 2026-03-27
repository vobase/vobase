import { createFileRoute } from '@tanstack/react-router';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';

import { type Theme, useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

const themeOptions: {
  value: Theme;
  label: string;
  icon: typeof SunIcon;
  description: string;
}[] = [
  {
    value: 'light',
    label: 'Light',
    icon: SunIcon,
    description: 'Always use light mode',
  },
  {
    value: 'dark',
    label: 'Dark',
    icon: MoonIcon,
    description: 'Always use dark mode',
  },
  {
    value: 'system',
    label: 'System',
    icon: MonitorIcon,
    description: 'Follow system preference',
  },
];

function AppearancePage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Customize how the interface looks.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Theme</p>
        <div className="flex gap-3">
          {themeOptions.map(({ value, label, icon: Icon, description }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              className={cn(
                'flex flex-1 flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors hover:bg-accent',
                theme === value
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'border-border text-muted-foreground',
              )}
            >
              <Icon
                className={cn('h-5 w-5', theme === value ? 'text-primary' : '')}
              />
              <span
                className={cn(
                  'font-medium',
                  theme === value ? 'text-foreground' : '',
                )}
              >
                {label}
              </span>
              <span className="text-center text-xs leading-tight text-muted-foreground">
                {description}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_app/settings/appearance')({
  component: AppearancePage,
});
