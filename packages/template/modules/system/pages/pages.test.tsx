import { describe, expect, it } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';

import { SystemDashboardPage } from './list';
import { SystemLogsPage } from './logs';

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

describe('System module pages', () => {
  it('renders dashboard page without throwing', () => {
    const queryClient = createTestQueryClient();

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SystemDashboardPage />
      </QueryClientProvider>,
    );

    expect(markup).toContain('Operations dashboard');
  });

  it('renders logs page without throwing', () => {
    const queryClient = createTestQueryClient();

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <SystemLogsPage />
      </QueryClientProvider>,
    );

    expect(markup).toContain('Audit log');
  });
});
