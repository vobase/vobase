import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HomePage } from './home';

describe('HomePage', () => {
  it('renders the dashboard shell without throwing', () => {
    const queryClient = new QueryClient();

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>
    );

    expect(markup).toContain('Dashboard');
    expect(markup).toContain('Welcome to your vobase project.');
  });
});
