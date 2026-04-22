'use client';

import { ReactNode, useEffect, useState } from 'react';
import AppNav from '@/components/AppNav';
import Sidebar from '@/components/Sidebar';
import SidebarTopBar from '@/components/SidebarTopBar';

const LAYOUT = (process.env.NEXT_PUBLIC_NAV_LAYOUT || 'topbar').toLowerCase();
const SIDEBAR_MODE = LAYOUT === 'sidebar';
const COLLAPSED_KEY = 'dealcore:sidebar:collapsed';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = window.localStorage.getItem(COLLAPSED_KEY);
    if (stored !== null) return stored === 'true';
  } catch {}
  return window.matchMedia?.('(max-width: 1023px) and (min-width: 768px)').matches ?? false;
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCollapsed(readCollapsed());
  }, []);

  useEffect(() => {
    if (!SIDEBAR_MODE || !mounted) return;
    try {
      window.localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {}
  }, [collapsed, mounted]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  if (!SIDEBAR_MODE) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <AppNav />
        {children}
      </div>
    );
  }

  const contentPadding = collapsed ? 'md:pl-16' : 'md:pl-60';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-gray-900/50 md:hidden"
        />
      )}
      <div className={`${contentPadding} transition-[padding] duration-200`}>
        <SidebarTopBar onOpenMobileSidebar={() => setMobileOpen(true)} />
        {children}
      </div>
    </div>
  );
}
