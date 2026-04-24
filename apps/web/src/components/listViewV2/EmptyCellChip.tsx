'use client';

import Link from 'next/link';

interface Props {
  value: number | null | undefined;
  formatted: string; // e.g. "$120k" when value present
  cta: string; // e.g. "+ MAO"
  href: string;
  colorClass?: string; // optional text color for formatted value
  title?: string;
}

/**
 * Either displays a formatted numeric value or a faded CTA chip that links
 * to the right lead-detail tab for completing the input. Reserves a minimum
 * width so toggling between empty and filled doesn't reflow the column.
 */
export default function EmptyCellChip({
  value,
  formatted,
  cta,
  href,
  colorClass = 'text-gray-700 dark:text-gray-300',
  title,
}: Props) {
  if (value != null && isFinite(value as number)) {
    return (
      <span
        title={title}
        className={`inline-block min-w-[52px] text-right text-xs font-semibold ${colorClass}`}
      >
        {formatted}
      </span>
    );
  }
  return (
    <Link
      href={href}
      title={title || 'Add this value'}
      className="inline-block min-w-[52px] text-right text-[11px] text-primary-500 dark:text-primary-400 hover:underline"
      onClick={(e) => e.stopPropagation()}
    >
      {cta}
    </Link>
  );
}
