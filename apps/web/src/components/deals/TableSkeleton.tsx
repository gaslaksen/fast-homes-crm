'use client';

interface Props {
  rows?: number;
}

export default function TableSkeleton({ rows = 8 }: Props) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 rounded bg-gray-100 dark:bg-gray-800/60 animate-pulse"
        />
      ))}
    </div>
  );
}
