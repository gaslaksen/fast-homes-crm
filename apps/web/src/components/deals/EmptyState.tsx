'use client';

import Link from 'next/link';

interface Props {
  variant: 'no-matches' | 'no-deals';
  onClearFilters?: () => void;
}

export default function EmptyState({ variant, onClearFilters }: Props) {
  if (variant === 'no-matches') {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          No deals match your filters.
        </p>
        {onClearFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="text-sm font-medium text-primary-600 hover:underline dark:text-primary-400"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <p className="mb-1 text-base font-medium text-gray-900 dark:text-gray-100">
        No deals yet.
      </p>
      <p className="mb-4 max-w-md text-sm text-gray-600 dark:text-gray-400">
        Your deals will appear here once leads have offers in motion. Head to
        Leads to find ones to advance.
      </p>
      <Link
        href="/leads"
        className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
      >
        Go to Leads
      </Link>
    </div>
  );
}
