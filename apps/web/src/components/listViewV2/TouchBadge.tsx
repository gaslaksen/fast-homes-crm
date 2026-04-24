'use client';

import { touchColor } from '@/lib/kanbanThresholds';

const CLASS: Record<ReturnType<typeof touchColor>, string> = {
  green:
    'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
  neutral: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  yellow: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400',
  red: 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400',
};

export default function TouchBadge({ count }: { count: number }) {
  const cls = CLASS[touchColor(count)];
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[24px] px-1.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}
      title={`${count} touch${count === 1 ? '' : 'es'}`}
    >
      {count}
    </span>
  );
}
