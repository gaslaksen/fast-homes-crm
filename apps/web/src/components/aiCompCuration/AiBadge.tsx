'use client';

import type { AiCurationDecision } from '@/lib/aiCompCuration/types';

interface Props {
  decision: AiCurationDecision | undefined;
}

const STYLE: Record<AiCurationDecision['inclusion'], { glyph: string; cls: string; label: string }> = {
  recommend_include: {
    glyph: '✨ ✓',
    cls:
      'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800',
    label: 'AI: Recommend include',
  },
  borderline: {
    glyph: '✨ ⚠',
    cls:
      'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-800',
    label: 'AI: Borderline',
  },
  recommend_exclude: {
    glyph: '✨ ✗',
    cls:
      'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-300 dark:border-red-800',
    label: 'AI: Recommend exclude',
  },
};

export default function AiBadge({ decision }: Props) {
  if (!decision) return null;
  const style = STYLE[decision.inclusion];
  const tooltip = `${style.label} (rank ${decision.rank}) — ${decision.reasoning}${
    decision.flags.length > 0 ? `\nFlags: ${decision.flags.join(', ')}` : ''
  }`;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${style.cls}`}
      title={tooltip}
      aria-label={style.label}
    >
      {style.glyph}
      <span className="text-[10px] opacity-80">#{decision.rank}</span>
    </span>
  );
}
