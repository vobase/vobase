import { createFileRoute } from '@tanstack/react-router';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';

import { ContentSection } from '@/components/content-section';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
    <ContentSection
      title="Appearance"
      desc="Customize how the interface looks."
    >
      <RadioGroup
        value={theme}
        onValueChange={(value) => setTheme(value as Theme)}
        className="flex gap-3"
      >
        {themeOptions.map(({ value, label, icon: Icon, description }) => (
          <label
            key={value}
            htmlFor={`theme-${value}`}
            className={cn(
              'flex flex-1 cursor-pointer flex-col items-center gap-2 rounded-lg border p-4 text-sm transition-colors hover:bg-accent',
              theme === value
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-border text-muted-foreground',
            )}
          >
            <RadioGroupItem
              id={`theme-${value}`}
              value={value}
              className="sr-only"
            />
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
          </label>
        ))}
      </RadioGroup>
    </ContentSection>
  );
}

export const Route = createFileRoute('/_app/settings/appearance')({
  component: AppearancePage,
});
