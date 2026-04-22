'use client';

import { ReactNode } from 'react';

export default function SidebarNavSection({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mb-4">
      {!collapsed && (
        <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {label}
        </div>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
