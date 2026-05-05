'use client';

import type { StepEvent, StepName } from '@/lib/aiCompCuration/types';

interface Props {
  events: StepEvent[];
  isRunning: boolean;
}

const STEP_LABELS: Record<StepName, string> = {
  load_subject: 'Loading subject + comps',
  classify_type: 'Classifying property type',
  filter_type_mismatches: 'Filtering type mismatches',
  filter_constraints: 'Applying hard constraints',
  derive_density: 'Deriving market density',
  cache_check: 'Checking cache',
  expansion_tier: 'Expanding search radius',
  photo_budget: 'Allocating photo budget',
  fetch_resize: 'Fetching + resizing photos',
  build_prompt: 'Building AI prompt',
  anthropic_call: 'AI evaluating comps',
  parse: 'Parsing AI response',
  persist: 'Persisting result',
};

const STEP_ORDER: StepName[] = [
  'load_subject',
  'classify_type',
  'filter_type_mismatches',
  'filter_constraints',
  'derive_density',
  'cache_check',
  'expansion_tier',
  'photo_budget',
  'fetch_resize',
  'build_prompt',
  'anthropic_call',
  'parse',
  'persist',
];

type Status = 'pending' | 'in_progress' | 'done';

function statusFor(step: StepName, events: StepEvent[]): Status {
  const last = [...events].reverse().find((e) => e.step === step);
  if (!last) return 'pending';
  if (last.status === 'done') return 'done';
  return 'in_progress';
}

function payloadFor(step: StepName, events: StepEvent[]): string | null {
  const done = [...events].reverse().find(
    (e) => e.step === step && e.status === 'done',
  );
  if (!done?.payload) return null;
  const p = done.payload;
  switch (step) {
    case 'load_subject':
      return `${p.compCount ?? '?'} candidate comps in pool`;
    case 'filter_type_mismatches':
      return `${p.kept ?? 0} kept, ${p.excluded ?? 0} type-mismatch excluded`;
    case 'filter_constraints':
      return `${p.kept ?? 0} kept, ${p.excluded ?? 0} constraint excluded`;
    case 'derive_density':
      return p.density ? String(p.density) : null;
    case 'cache_check':
      return p.hit ? 'cache hit' : 'no cache — running fresh';
    case 'expansion_tier':
      return p.tiersConsidered ? `tiers ${JSON.stringify(p.tiersConsidered)}` : null;
    case 'photo_budget':
      return `${p.subjectPhotosTaken ?? 0} subject + ${p.candidatePhotosTaken ?? 0} candidates`;
    case 'fetch_resize':
      return `${p.succeeded ?? 0} of ${p.requested ?? 0} succeeded`;
    case 'build_prompt':
      return p.promptChars ? `${p.promptChars} chars, ${p.photoCount ?? 0} photos` : null;
    case 'anthropic_call':
      return p.latencyMs ? `${(Number(p.latencyMs) / 1000).toFixed(1)}s` : null;
    case 'parse':
      return p.ok ? 'parsed OK' : 'parse failed';
    case 'persist':
      return p.curationId ? 'saved' : null;
    default:
      return null;
  }
}

export default function CurationProgressDrawer({ events, isRunning }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-900"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          {isRunning ? 'AI curation in progress' : 'AI curation finished'}
        </h3>
      </div>
      <ol className="space-y-1.5">
        {STEP_ORDER.map((step) => {
          const status = statusFor(step, events);
          const detail = payloadFor(step, events);
          return (
            <li
              key={step}
              className={`flex items-start gap-2 text-xs ${
                status === 'pending'
                  ? 'text-gray-400 dark:text-gray-600'
                  : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              <span className="w-4 inline-flex justify-center">
                {status === 'done' && <span className="text-emerald-500">✓</span>}
                {status === 'in_progress' && (
                  <span className="inline-block w-3 h-3 border-2 border-gray-300 dark:border-gray-600 border-t-emerald-500 rounded-full animate-spin" />
                )}
                {status === 'pending' && <span>○</span>}
              </span>
              <span className="flex-1">
                {STEP_LABELS[step]}
                {detail && (
                  <span className="ml-2 text-[10px] text-gray-500 dark:text-gray-500">
                    — {detail}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
