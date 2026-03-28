import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { ContentSection } from '@/components/content-section';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

const displaySchema = z.object({
  sidebarDefault: z.enum(['open', 'collapsed']),
});

type DisplayFormValues = z.infer<typeof displaySchema>;

function readSidebarCookie(): 'open' | 'collapsed' {
  const match = document.cookie
    .split('; ')
    .find((row) => row.startsWith('sidebar_state='));
  if (match) {
    const val = match.split('=')[1];
    return val === 'false' ? 'collapsed' : 'open';
  }
  return 'open';
}

const sidebarOptions: {
  value: 'open' | 'collapsed';
  label: string;
  description: string;
}[] = [
  {
    value: 'open',
    label: 'Open',
    description: 'Sidebar is visible by default',
  },
  {
    value: 'collapsed',
    label: 'Collapsed',
    description: 'Sidebar is hidden by default',
  },
];

function DisplayPage() {
  const form = useForm<DisplayFormValues>({
    resolver: zodResolver(displaySchema),
    defaultValues: {
      sidebarDefault: readSidebarCookie(),
    },
  });

  function onSubmit(data: DisplayFormValues) {
    const cookieValue = data.sidebarDefault === 'open' ? 'true' : 'false';
    // biome-ignore lint/suspicious/noDocumentCookie: required for sidebar state persistence
    document.cookie = `sidebar_state=${cookieValue}; path=/; max-age=${60 * 60 * 24 * 7}`;
    toast.success('Display preferences saved. Takes effect on next page load.');
  }

  return (
    <ContentSection
      title="Display"
      desc="Configure display and sidebar preferences."
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          <FormField
            control={form.control}
            name="sidebarDefault"
            render={({ field }) => (
              <FormItem>
                <div className="mb-2">
                  <span className="text-sm font-medium">
                    Sidebar default state
                  </span>
                </div>
                <FormControl>
                  <RadioGroup
                    value={field.value}
                    onValueChange={field.onChange}
                    className="flex gap-3"
                  >
                    {sidebarOptions.map(({ value, label, description }) => (
                      <label
                        key={value}
                        htmlFor={`sidebar-${value}`}
                        className={cn(
                          'flex flex-1 cursor-pointer flex-col gap-1 rounded-lg border p-4 text-sm transition-colors hover:bg-accent',
                          field.value === value
                            ? 'border-primary bg-accent text-accent-foreground'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        <RadioGroupItem
                          id={`sidebar-${value}`}
                          value={value}
                          className="sr-only"
                        />
                        <span
                          className={cn(
                            'font-medium',
                            field.value === value ? 'text-foreground' : '',
                          )}
                        >
                          {label}
                        </span>
                        <span className="text-xs leading-tight text-muted-foreground">
                          {description}
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div>
            <Button type="submit">Save preferences</Button>
          </div>
        </form>
      </Form>
    </ContentSection>
  );
}

export const Route = createFileRoute('/_app/settings/display')({
  component: DisplayPage,
});
