import { Header } from '@/components/layout/header';

/**
 * Standard page layout with header + scrollable content.
 * Used by most module layouts. Messaging uses its own full-height layout instead.
 */
export function PageLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header fixed />
      <div id="content" className="flex flex-1 flex-col overflow-y-auto">
        {children}
      </div>
    </>
  );
}
