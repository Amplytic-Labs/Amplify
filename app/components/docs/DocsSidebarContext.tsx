'use client';

import { createContext, useContext, useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Docs sidebar state context — shared between DocsHeader & DocsSidebar
// for mobile toggle coordination.
// ---------------------------------------------------------------------------

interface DocsSidebarContextValue {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const DocsSidebarContext = createContext<DocsSidebarContextValue>({
  mobileOpen: false,
  setMobileOpen: () => {},
});

export function useDocsSidebar() {
  return useContext(DocsSidebarContext);
}

/**
 * Provider that wraps the docs layout and coordinates the mobile sidebar
 * open/close state between DocsHeader (toggle button) and DocsSidebar
 * (overlay panel).
 */
export function DocsSidebarProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpenState] = useState(false);

  const setMobileOpen = useCallback((open: boolean) => {
    setMobileOpenState(open);
  }, []);

  return (
    <DocsSidebarContext.Provider value={{ mobileOpen, setMobileOpen }}>
      {children}
    </DocsSidebarContext.Provider>
  );
}
