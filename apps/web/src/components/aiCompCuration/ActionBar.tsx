'use client';

interface Props {
  canPick: boolean;
  picking: boolean;
  onPickForMe: () => void;
  onAddManual?: () => void;
  onRerunWithDifferentSettings: () => void;
}

// Bottom action bar. "Pick for me" is the primary CTA; the other two
// are secondary. On mobile (<768px) actions stack vertically.
export default function ActionBar({
  canPick,
  picking,
  onPickForMe,
  onAddManual,
  onRerunWithDifferentSettings,
}: Props) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 pt-2">
      <button
        type="button"
        disabled={!canPick || picking}
        onClick={onPickForMe}
        className="text-xs px-3 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        title="Auto-check the AI's recommended-include comps in the list below"
      >
        {picking ? 'Applying…' : 'Pick for me'}
      </button>
      {onAddManual && (
        <button
          type="button"
          onClick={onAddManual}
          className="text-xs px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          + Add manual comp
        </button>
      )}
      <button
        type="button"
        onClick={onRerunWithDifferentSettings}
        className="text-xs px-3 py-2 rounded text-gray-600 dark:text-gray-400 hover:underline sm:ml-auto"
      >
        Re-run with different settings
      </button>
    </div>
  );
}
