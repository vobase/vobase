import { useEffect, useState } from 'react';

const STORAGE_KEY = 'vobase-sidebar-collapsed';

export function useSidebar() {
  const [isCollapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(isCollapsed));
    } catch {
      // ignore
    }
  }, [isCollapsed]);

  const toggle = () => setCollapsed((prev) => !prev);

  return { isCollapsed, toggle, setCollapsed };
}
