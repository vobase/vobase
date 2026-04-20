import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from './components/theme-provider'
import { SearchProvider } from './providers/search-provider'
import { router } from './routes'
import './styles/app.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

const root = document.getElementById('root')
if (root && !root.innerHTML) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <NuqsAdapter>
            <SearchProvider>
              <RouterProvider router={router} />
            </SearchProvider>
          </NuqsAdapter>
        </QueryClientProvider>
      </ThemeProvider>
    </React.StrictMode>,
  )
}
