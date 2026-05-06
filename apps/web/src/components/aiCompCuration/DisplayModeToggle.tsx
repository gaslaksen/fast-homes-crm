'use client';

export type DisplayMode = 'cards' | 'table' | 'map';

interface Props {
  value: DisplayMode;
  onChange: (v: DisplayMode) => void;
}

const ICONS: Record<DisplayMode, JSX.Element> = {
  cards: (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
      />
    </svg>
  ),
  table: (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3v18M9 3v18M14.25 3v18M19.5 3v18M3 4.5h18M3 9.75h18M3 15h18"
      />
    </svg>
  ),
  map: (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 6.75 3 3v15.75l6 3.75M9 6.75 15 3M9 6.75v15.75M15 3l6 3.75v15.75l-6-3.75M15 3v15.75"
      />
    </svg>
  ),
};

const LABELS: Record<DisplayMode, string> = {
  cards: 'Cards',
  table: 'Table',
  map: 'Map',
};

export default function DisplayModeToggle({ value, onChange }: Props) {
  const modes: DisplayMode[] = ['cards', 'table', 'map'];
  return (
    <div
      role="tablist"
      aria-label="Display mode"
      className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden text-xs"
    >
      {modes.map((m, i) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={value === m}
          onClick={() => onChange(m)}
          className={`px-2.5 py-1.5 inline-flex items-center gap-1 ${
            i > 0 ? 'border-l border-gray-300 dark:border-gray-600' : ''
          } ${
            value === m
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
        >
          {ICONS[m]}
          {LABELS[m]}
        </button>
      ))}
    </div>
  );
}
