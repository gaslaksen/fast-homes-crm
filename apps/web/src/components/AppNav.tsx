'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { authAPI } from '@/lib/api';
import Avatar from '@/components/Avatar';
import Logo from '@/components/Logo';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Leads',     href: '/leads' },
  { label: 'Drip Campaigns', href: '/drip-campaigns' },
  { label: 'Team',      href: '/settings/team' },
  { label: 'Settings',  href: '/settings' },
];

const BOTTOM_NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: '📊' },
  { label: 'Leads',     href: '/leads',     icon: '🏠' },
  { label: 'Campaigns', href: '/drip-campaigns', icon: '🔁' },
  { label: 'Team',      href: '/settings/team', icon: '👥' },
  { label: 'Settings',  href: '/settings',  icon: '⚙️' },
];

export default function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    authAPI.getMe().then(res => setUser(res.data)).catch(() => {});
  }, []);

  // Click-outside handler for profile dropdown
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

  const isActive = (href: string) =>
    href === '/dashboard'
      ? pathname === '/dashboard'
      : pathname.startsWith(href);

  const handleSignOut = () => {
    localStorage.removeItem('auth_token');
    router.push('/login');
  };

  const userName = user ? `${user.firstName} ${user.lastName}` : '';

  return (
    <>
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50">
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">

        {/* Logo + Desktop Nav */}
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="flex-shrink-0">
            <Logo size="sm" />
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map(({ label, href }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive(href)
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {/* Theme toggle */}
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

          {/* Profile dropdown (desktop) */}
          <div className="hidden md:block relative" ref={dropdownRef}>
            <button
              onClick={() => setProfileOpen(o => !o)}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Avatar
                name={userName || 'User'}
                avatarUrl={user?.avatarUrl}
                size="sm"
              />
            </button>

            {profileOpen && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                {user && (
                  <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{userName}</div>
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

          {/* Hamburger (mobile only) */}
          <button
            onClick={() => setMobileOpen(o => !o)}
            className="md:hidden flex flex-col justify-center items-center w-8 h-8 gap-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            aria-label="Toggle menu"
          >
            <span className={`block h-0.5 w-5 bg-gray-600 dark:bg-gray-400 transition-transform duration-200 ${mobileOpen ? 'translate-y-2 rotate-45' : ''}`} />
            <span className={`block h-0.5 w-5 bg-gray-600 dark:bg-gray-400 transition-opacity duration-200 ${mobileOpen ? 'opacity-0' : ''}`} />
            <span className={`block h-0.5 w-5 bg-gray-600 dark:bg-gray-400 transition-transform duration-200 ${mobileOpen ? '-translate-y-2 -rotate-45' : ''}`} />
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-3 space-y-1 shadow-lg">
          {NAV_ITEMS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={`block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive(href)
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
              }`}
            >
              {label}
            </Link>
          ))}
          <Link
            href="/settings/profile"
            onClick={() => setMobileOpen(false)}
            className="block px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            Profile
          </Link>
          <div className="border-t border-gray-100 dark:border-gray-700 pt-2 mt-2">
            <button
              onClick={handleSignOut}
              className="block w-full text-left px-3 py-2.5 rounded-lg text-sm text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </header>

    {/* Mobile bottom nav */}
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-stretch h-16 safe-area-inset-bottom">
      {BOTTOM_NAV_ITEMS.map(({ label, href, icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              active ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <span className="text-xl leading-none">{icon}</span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
    </>
  );
}
