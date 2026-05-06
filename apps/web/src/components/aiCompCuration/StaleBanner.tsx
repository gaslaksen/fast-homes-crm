'use client';

interface Props {
  onRerun: () => void;
}

// Shown when the underlying comp pool has shifted (provider toggle,
// refresh, manual add) since the AI curation was last computed. The
// AI's recommendations remain visible but are flagged as potentially
// stale so the user can re-run for fresh analysis.
export default function StaleBanner({ onRerun }: Props) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 p-2.5 text-xs text-yellow-900 dark:text-yellow-200 flex items-center gap-2"
    >
      <span aria-hidden>⚠️</span>
      <span className="flex-1">
        Comps changed since this curation. Run again to refresh
        recommendations.
      </span>
      <button
        type="button"
        onClick={onRerun}
        className="text-xs font-medium px-2 py-1 rounded bg-yellow-200 dark:bg-yellow-800/50 hover:bg-yellow-300 dark:hover:bg-yellow-800 text-yellow-900 dark:text-yellow-100"
      >
        Re-run
      </button>
    </div>
  );
}
