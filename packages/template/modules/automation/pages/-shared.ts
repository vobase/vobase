import { automationClient } from '@/lib/api-client';

export type Task = {
  id: string;
  adapterId: string;
  action: string;
  status: string;
  requestedBy: string;
  assignedTo: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorMessage: string | null;
  domSnapshot: string | null;
  createdAt: string;
  updatedAt: string;
};

type StatusVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export const STATUS_VARIANT: Record<string, StatusVariant> = {
  pending: 'outline',
  executing: 'secondary',
  completed: 'default',
  failed: 'destructive',
  timeout: 'destructive',
  cancelled: 'secondary',
};

export async function fetchTasks(): Promise<Task[]> {
  const res = await automationClient.tasks.$get();
  if (!res.ok) throw new Error('Failed to fetch tasks');
  return res.json() as unknown as Promise<Task[]>;
}
