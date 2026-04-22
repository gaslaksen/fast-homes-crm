'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

interface SidebarNavItemProps {
  label: string;
  href: string;
  icon: ReactNode;
  badge?: number;
  collapsed: boolean;
  onNavigate?: () => void;
}

export default function SidebarNavItem({
  label,
  href,
  icon,
  badge,
  collapsed,
  onNavigate,
}: SidebarNavItemProps) {
  const pathname = usePathname();
  const active =
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

  const base =
    'relative flex items-center rounded-md text-sm font-medium transition-colors group';
  const state = active
    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400'
    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800';
  const layout = collapsed ? 'justify-center w-10 h-10 mx-auto' : 'gap-3 px-3 py-2';

  const hasBadge = typeof badge === 'number' && badge > 0;

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-label={label}
      className={`${base} ${state} ${layout}`}
    >
      <span className="relative flex-shrink-0 w-5 h-5 flex items-center justify-center">
        {icon}
        {collapsed && hasBadge && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary-600 dark:bg-primary-400 ring-2 ring-white dark:ring-gray-900" />
        )}
      </span>
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && hasBadge && (
        <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-semibold rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300">
          {badge}
        </span>
      )}
      {collapsed && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-gray-900 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg"
        >
          {label}
          {hasBadge && <span className="ml-1.5 text-primary-300">({badge})</span>}
        </span>
      )}
    </Link>
  );
}
