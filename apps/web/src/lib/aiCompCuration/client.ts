// Thin wrapper over native EventSource for the curation SSE endpoint.
// Resolves on `done`, rejects on `error`, calls onStep on `step` events.
//
// EventSource is GET-only and doesn't carry custom auth headers, so we
// pass the JWT via query string. The API decodes it the same way the
// existing Axios interceptor does. This is acceptable for first-party
// SSE — the token never leaves origin.

import api from '@/lib/api';
import type {
  CurationEvent,
  CurationResult,
  RunCurationInput,
  StepEvent,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface CurationStream {
  promise: Promise<CurationResult>;
  cancel: () => void;
}

export interface RunCurationOptions extends RunCurationInput {
  leadId: string;
  onStep?: (evt: StepEvent) => void;
  onCacheHit?: (result: CurationResult) => void;
}

export function runCuration(opts: RunCurationOptions): CurationStream {
  const params = new URLSearchParams();
  params.set('valuationMode', opts.valuationMode);
  params.set('hardConstraints', JSON.stringify(opts.hardConstraints));
  params.set(
    'maxDistance',
    typeof opts.maxDistance === 'number'
      ? String(opts.maxDistance)
      : opts.maxDistance,
  );
  if (opts.force) params.set('force', 'true');
  const token =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('auth_token')
      : null;
  if (token) params.set('token', token);

  const url = `${API_URL}/leads/${encodeURIComponent(
    opts.leadId,
  )}/curate?${params.toString()}`;

  const es = new EventSource(url, { withCredentials: false });

  let resolved = false;
  let promiseResolve!: (r: CurationResult) => void;
  let promiseReject!: (e: Error) => void;
  const promise = new Promise<CurationResult>((res, rej) => {
    promiseResolve = res;
    promiseReject = rej;
  });

  const finish = () => {
    if (!resolved) {
      resolved = true;
      es.close();
    }
  };

  // NestJS SSE emits one MessageEvent per Subject.next; the `data` field
  // carries the JSON. The `type` we mapped server-side becomes the event
  // name. Listen on the default `message` event for compatibility.
  es.onmessage = (e) => {
    try {
      const evt = JSON.parse(e.data) as CurationEvent;
      handle(evt);
    } catch (err) {
      // Malformed payload — ignore individual frame, surface in onerror.
    }
  };

  es.onerror = () => {
    if (resolved) return;
    finish();
    promiseReject(new Error('SSE connection error'));
  };

  function handle(evt: CurationEvent) {
    if (evt.type === 'step') {
      opts.onStep?.(evt);
    } else if (evt.type === 'cache_hit') {
      opts.onCacheHit?.(evt.result);
      finish();
      promiseResolve(evt.result);
    } else if (evt.type === 'done') {
      finish();
      promiseResolve(evt.result);
    } else if (evt.type === 'error') {
      finish();
      const e = new Error(evt.message);
      (e as any).code = evt.code;
      (e as any).step = evt.step;
      promiseReject(e);
    }
  }

  return {
    promise,
    cancel: () => {
      finish();
      promiseReject(new Error('cancelled'));
    },
  };
}

export async function getLatestCuration(
  leadId: string,
  input: RunCurationInput,
): Promise<{
  result: CurationResult | null;
  curationId?: string;
  createdAt?: string;
}> {
  const params: Record<string, string> = {
    valuationMode: input.valuationMode,
    hardConstraints: JSON.stringify(input.hardConstraints),
    maxDistance:
      typeof input.maxDistance === 'number'
        ? String(input.maxDistance)
        : input.maxDistance,
  };
  const res = await api.get(
    `/leads/${encodeURIComponent(leadId)}/curate/latest`,
    { params },
  );
  return res.data;
}

export async function bulkSelectComps(
  analysisId: string,
  includeIds: string[],
): Promise<{ ok: boolean; leadId?: string; includedCount?: number }> {
  const res = await api.post(
    `/comp-analyses/${encodeURIComponent(analysisId)}/comps/bulk-select`,
    { include: includeIds },
  );
  return res.data;
}
