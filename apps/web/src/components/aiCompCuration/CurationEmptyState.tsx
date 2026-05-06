'use client';

interface Props {
  variant:
    | 'idle'
    | 'type_required'
    | 'zero_candidates'
    | 'no_curated'
    | 'network_error'
    | 'parse_error';
  message?: string;
  onRetry?: () => void;
  onSetType?: () => void;
  onShowAll?: () => void;
}

const COPY: Record<Props['variant'], { title: string; body: string }> = {
  idle: {
    title: 'AI curation ready',
    body:
      'Pick a valuation mode and run AI curation to get ranked recommendations with reasoning. You stay in control of the final selection.',
  },
  type_required: {
    title: 'Subject property type required',
    body:
      "We can't curate comps until the subject property's type is set. Mobile/manufactured vs SFR vs condo materially changes which comps are valid.",
  },
  zero_candidates: {
    title: 'No candidate comps to evaluate',
    body:
      "There are no comps in this lead's pool yet. Fetch comps from REAPI or BatchData first, then run curation.",
  },
  no_curated: {
    title: 'No strong comps found in this market',
    body:
      "The AI couldn't confidently recommend any comps for this property. The candidate pool may be too thin or too varied for a curated selection. Manual review recommended.",
  },
  network_error: {
    title: 'Curation failed',
    body:
      'The AI curation request could not complete. This is usually transient — try again in a moment.',
  },
  parse_error: {
    title: 'AI response could not be parsed',
    body:
      'The AI returned a response but it did not match the expected JSON shape. The full response is saved for review. Try again or pick comps manually.',
  },
};

export default function CurationEmptyState({
  variant,
  message,
  onRetry,
  onSetType,
  onShowAll,
}: Props) {
  const copy = COPY[variant];
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 bg-white dark:bg-gray-900 text-center">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">
        {copy.title}
      </h3>
      <p className="text-xs text-gray-600 dark:text-gray-400 max-w-md mx-auto leading-relaxed">
        {message || copy.body}
      </p>
      <div className="mt-4 flex justify-center gap-2">
        {variant === 'type_required' && onSetType && (
          <button
            type="button"
            onClick={onSetType}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
          >
            Set property type
          </button>
        )}
        {(variant === 'network_error' || variant === 'parse_error') && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200"
          >
            Retry
          </button>
        )}
        {variant === 'no_curated' && (
          <>
            {onShowAll && (
              <button
                type="button"
                onClick={onShowAll}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white"
              >
                Show all ranked comps
              </button>
            )}
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="text-xs px-3 py-1.5 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200"
              >
                Re-run with different settings
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
