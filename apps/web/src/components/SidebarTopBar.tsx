'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { authAPI } from '@/lib/api';
import Avatar from '@/components/Avatar';

export default function SidebarTopBar({
  onOpenMobileSidebar,
}: {
  onOpenMobileSidebar: () => void;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    authAPI.getMe().then((res) => setUser(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!profileOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [profileOpen]);

  const handleSignOut = () => {
    localStorage.removeItem('auth_token');
    router.push('/login');
  };

  const userName = user ? `${user.firstName} ${user.lastName}` : '';

  return (
    <header className="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between h-14 px-4 sm:px-6">
        {/* Mobile hamburger */}
        <button
          onClick={onOpenMobileSidebar}
          className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Open menu"
        >
          <span className="block h-0.5 w-5 bg-gray-600 dark:bg-gray-400" />
          <span className="block h-0.5 w-5 bg-gray-600 dark:bg-gray-400" />
          <span className="block h-0.5 w-5 bg-gray-600 dark:bg-gray-400" />
        </button>

        {/* Command palette trigger — dispatches the global Cmd+K shortcut */}
        <div className="flex-1 flex items-center">
          <button
            type="button"
            onClick={() => {
              const ev = new KeyboardEvent('keydown', {
                key: 'k',
                code: 'KeyK',
                metaKey: true,
                ctrlKey: !navigator.platform.includes('Mac'),
                bubbles: true,
              });
              document.dispatchEvent(ev);
            }}
            className="hidden md:flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 rounded-lg px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50 transition-colors"
            aria-label="Open command palette"
          >
            <span>Search or jump to…</span>
            <kbd className="text-[10px] bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1 py-0.5">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-3">
          {mounted && (
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Toggle dark mode"
            >
              {theme === 'dark' ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
          )}

          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setProfileOpen((o) => !o)}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              aria-label="Open profile menu"
            >
              <Avatar name={userName || 'User'} avatarUrl={user?.avatarUrl} size="sm" />
            </button>
            {profileOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                {user && (
                  <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {userName}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{user.email}</div>
                  </div>
                )}
                <Link
                  href="/settings/profile"
                  onClick={() => setProfileOpen(false)}
                  className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Profile
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="block px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Settings
                </Link>
                <div className="border-t border-gray-100 dark:border-gray-700">
                  <button
                    onClick={handleSignOut}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
