import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { ContentSection } from '@/components/content-section';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';

const STORAGE_KEY = 'vobase-notification-prefs';

const notificationsSchema = z.object({
  escalationAlerts: z.boolean(),
  channelActivity: z.boolean(),
  securityEmails: z.boolean(),
});

type NotificationsFormValues = z.infer<typeof notificationsSchema>;

function loadPrefs(): NotificationsFormValues {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return notificationsSchema.parse(JSON.parse(raw));
    }
  } catch {
    // fall through to defaults
  }
  return {
    escalationAlerts: true,
    channelActivity: true,
    securityEmails: true,
  };
}

const notificationItems: {
  name: keyof NotificationsFormValues;
  label: string;
  description: string;
  disabled?: boolean;
}[] = [
  {
    name: 'escalationAlerts',
    label: 'Escalation alerts',
    description: 'Receive email alerts when AI agents escalate to humans',
  },
  {
    name: 'channelActivity',
    label: 'Channel activity',
    description: 'Get notified about new messages in your channels',
  },
  {
    name: 'securityEmails',
    label: 'Security emails',
    description: 'Receive emails about account security',
    disabled: true,
  },
];

function NotificationsPage() {
  const form = useForm<NotificationsFormValues>({
    resolver: zodResolver(notificationsSchema),
    defaultValues: loadPrefs(),
  });

  function onSubmit(data: NotificationsFormValues) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    toast.success('Notification preferences saved');
  }

  return (
    <ContentSection
      title="Notifications"
      desc="Configure how you receive notifications."
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col gap-4">
            {notificationItems.map(({ name, label, description, disabled }) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-4">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium leading-none">
                        {label}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {description}
                      </span>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={disabled}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            ))}
          </div>

          <div>
            <Button type="submit">Save preferences</Button>
          </div>
        </form>
      </Form>
    </ContentSection>
  );
}

export const Route = createFileRoute('/_app/settings/notifications')({
  component: NotificationsPage,
});
