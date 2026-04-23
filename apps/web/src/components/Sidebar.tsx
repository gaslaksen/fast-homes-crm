'use client';

import Link from 'next/link';
import { ReactNode } from 'react';
import Logo from '@/components/Logo';
import SidebarNavItem from '@/components/SidebarNavItem';
import SidebarNavSection from '@/components/SidebarNavSection';
import { useActionBadges } from '@/hooks/useActionBadges';

const iconClass = 'w-5 h-5';
const strokeProps = {
  fill: 'none',
  viewBox: '0 0 24 24',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const ICON = {
  dashboard: (
    <svg className={iconClass} {...strokeProps}>
      <path d="M3 3h7v9H3V3zM14 3h7v5h-7V3zM14 11h7v10h-7V11zM3 15h7v6H3v-6z" />
    </svg>
  ),
  inbox: (
    <svg className={iconClass} {...strokeProps}>
      <path d="M3 13h5l1 3h6l1-3h5M3 13V6a2 2 0 012-2h14a2 2 0 012 2v7M3 13v5a2 2 0 002 2h14a2 2 0 002-2v-5" />
    </svg>
  ),
  leads: (
    <svg className={iconClass} {...strokeProps}>
      <path d="M17 20h5v-2a4 4 0 00-3-3.87M9 12a4 4 0 100-8 4 4 0 000 8zm6-8a4 4 0 010 8M2 20v-2a4 4 0 014-4h6a4 4 0 014 4v2" />
    </svg>
  ),
  deals: (
    <svg className={iconClass} {...strokeProps}>
      <path d="M21 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6M3 13l2-7a2 2 0 012-2h10a2 2 0 012 2l2 7M3 13h18M10 17h4" />
    </svg>
  ),
  dealSearch: (
    <svg className={iconClass} {...strokeProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  ),
  drip: (
    <svg className={iconClass} {...strokeProps}>
      <path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" />
    </svg>
  ),
  comps: (
    <svg className={iconClass} {...strokeProps}>
      <path d="M3 3v18h18M7 14l4-4 4 4 5-6" />
    </svg>
  ),
  partners: (
    <svg className={iconClass} {...strokeProps}>
      <path d="M3 21v-2a4 4 0 013-3.87M21 21v-2a4 4 0 00-3-3.87M7 7a4 4 0 108 0 4 4 0 00-8 0zM16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  team: (
    <svg className={iconClass} {...strokeProps}>
      <path d="M12 4a4 4 0 100 8 4 4 0 000-8zM4 20v-1a6 6 0 016-6h4a6 6 0 016 6v1" />
    </svg>
  ),
  settings: (
    <svg className={iconClass} {...strokeProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 01-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1A1.7 1.7 0 009 19.4a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 01-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 012.9-2.9l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 012.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  ),
};

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
  badge?: number;
};

type NavGroup = { label: string; items: NavItem[] };

function buildNavGroups(badges: { needsReply: number; newLeads: number }): NavGroup[] {
  return [
    {
      label: 'Workspace',
      items: [
        { label: 'Dashboard', href: '/dashboard', icon: ICON.dashboard },
        { label: 'Inbox', href: '/inbox', icon: ICON.inbox, badge: badges.needsReply },
      ],
    },
    {
      label: 'Pipeline',
      items: [
        { label: 'Leads', href: '/leads', icon: ICON.leads, badge: badges.newLeads },
        { label: 'Deals', href: '/deals', icon: ICON.deals },
      ],
    },
    {
      label: 'Acquisition',
      items: [
        { label: 'Deal Search', href: '/deal-search', icon: ICON.dealSearch },
        { label: 'Drip Campaigns', href: '/drip-campaigns', icon: ICON.drip },
        { label: 'Comps & Analysis', href: '/comps-analysis', icon: ICON.comps },
      ],
    },
    {
      label: 'Network',
      items: [
        { label: 'Partners', href: '/settings/partners', icon: ICON.partners },
        { label: 'Team', href: '/settings/team', icon: ICON.team },
      ],
    },
  ];
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export default function Sidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const width = collapsed ? 'md:w-16' : 'md:w-60';
  const mobileTransform = mobileOpen ? 'translate-x-0' : '-translate-x-full';
  const badges = useActionBadges();
  const navGroups = buildNavGroups(badges);

  return (
    <aside
      className={`dark fixed top-0 left-0 h-screen z-40 w-60 ${width} md:translate-x-0 ${mobileTransform}
        transition-[width,transform] duration-200 ease-out
        bg-gray-900 border-r border-gray-800
        flex flex-col overflow-hidden`}
      aria-label="Primary"
    >
      {/* Logo header */}
      <div
        className={`flex items-center h-14 ${
          collapsed ? 'justify-center px-0' : 'px-4'
        }`}
      >
        <Link
          href="/dashboard"
          onClick={onCloseMobile}
          className="flex items-center"
          aria-label="Dealcore home"
        >
          {collapsed ? <Logo size="sm" showText={false} /> : <Logo size="md" />}
        </Link>
      </div>

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto overflow-x-hidden py-4 ${collapsed ? 'px-2' : 'px-3'}`}>
        {navGroups.map((group) => (
          <SidebarNavSection key={group.label} label={group.label} collapsed={collapsed}>
            {group.items.map((item) => (
              <SidebarNavItem
                key={item.href}
                label={item.label}
                href={item.href}
                icon={item.icon}
                badge={item.badge}
                collapsed={collapsed}
                onNavigate={onCloseMobile}
              />
            ))}
          </SidebarNavSection>
        ))}
      </nav>

      {/* Bottom: Settings + collapse toggle */}
      <div
        className={`border-t border-gray-800 py-3 ${collapsed ? 'px-2' : 'px-3'} space-y-1`}
      >
        <SidebarNavItem
          label="Settings"
          href="/settings"
          icon={ICON.settings}
          collapsed={collapsed}
          onNavigate={onCloseMobile}
        />
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`hidden md:flex items-center rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
            collapsed ? 'justify-center w-10 h-10 mx-auto' : 'w-full gap-3 px-3 py-2 text-sm font-medium'
          }`}
        >
          <svg
            className={`w-5 h-5 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}
            {...strokeProps}
          >
            <path d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
