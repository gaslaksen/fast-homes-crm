'use client';

interface Props {
  borderlineCount: number;
  excludedCount: number;
  expanded: boolean;
  onToggle: () => void;
}

// Inline expander that lives directly below the curated grid in
// "Curated" view. Clicking it slides down the borderline + excluded
// cards in the same grid format.
export default function ShowLessRelevantToggle({
  borderlineCount,
  excludedCount,
  expanded,
  onToggle,
}: Props) {
  const total = borderlineCount + excludedCount;
  if (total === 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 py-2 border border-dashed border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/50"
      aria-expanded={expanded}
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className="inline-block transition-transform"
          style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          aria-hidden
        >
          ▸
        </span>
        {expanded ? 'Hide' : 'Show'} {total} less-relevant comp
        {total === 1 ? '' : 's'} ({borderlineCount} borderline,{' '}
        {excludedCount} excluded)
      </span>
    </button>
  );
}
