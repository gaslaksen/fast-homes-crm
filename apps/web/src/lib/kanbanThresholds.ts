export const TOUCH_THRESHOLDS = {
  green: 5,
  neutral: 15,
  yellow: 25,
};

export const touchColor = (
  count: number,
): 'green' | 'neutral' | 'yellow' | 'red' => {
  if (count <= TOUCH_THRESHOLDS.green) return 'green';
  if (count <= TOUCH_THRESHOLDS.neutral) return 'neutral';
  if (count <= TOUCH_THRESHOLDS.yellow) return 'yellow';
  return 'red';
};

export const STALE_MS = 5 * 24 * 60 * 60 * 1000;

export const isStale = (lastTouched: string | null | undefined): boolean => {
  if (!lastTouched) return false;
  return Date.now() - new Date(lastTouched).getTime() > STALE_MS;
};

export const RECENTLY_MOVED_MS = 24 * 60 * 60 * 1000;

export const wasRecentlyMoved = (stageChangedAt: string | null | undefined): boolean => {
  if (!stageChangedAt) return false;
  return Date.now() - new Date(stageChangedAt).getTime() < RECENTLY_MOVED_MS;
};
