// Allocate a fixed photo budget across the subject and candidate pool.
//
// Strategy:
//   1. Subject gets up to SUBJECT_MAX (default 4) photos first.
//   2. Candidates are sorted by uncertainty (high → low), then by distance
//      ascending. Uncertainty is a caller-supplied score.
//   3. Each candidate gets 1 photo before any candidate gets a 2nd.
//   4. Stop when the total budget is exhausted.
//
// This avoids one photo-rich comp eating the budget at the expense of
// six other comps having any visual context at all.

export interface CandidatePhotoSource {
  candidateId: string;
  photoUrls: string[];
  uncertainty: number; // 0..1, higher = AI benefits more from photos
  distance: number; // miles from subject
}

export interface PhotoAllocation {
  // null compId means subject photo
  compId: string | null;
  url: string;
  // 1-based index into the original photoUrls array — useful for prompt labels
  photoIndex: number;
}

const DEFAULT_TOTAL = 30;
const DEFAULT_SUBJECT_MAX = 4;

export function selectPhotoBudget(
  subjectPhotoUrls: string[],
  candidates: CandidatePhotoSource[],
  options: { total?: number; subjectMax?: number } = {},
): PhotoAllocation[] {
  const total = options.total ?? DEFAULT_TOTAL;
  const subjectMax = options.subjectMax ?? DEFAULT_SUBJECT_MAX;

  const out: PhotoAllocation[] = [];

  // 1. Subject photos.
  const subjTake = Math.min(subjectMax, subjectPhotoUrls.length, total);
  for (let i = 0; i < subjTake; i++) {
    out.push({ compId: null, url: subjectPhotoUrls[i], photoIndex: i + 1 });
  }

  if (out.length >= total) return out;

  // 2. Sort candidates: uncertainty desc, then distance asc.
  const sorted = [...candidates].sort((a, b) => {
    if (b.uncertainty !== a.uncertainty) return b.uncertainty - a.uncertainty;
    return a.distance - b.distance;
  });

  // 3. Round-robin: every candidate gets photo #1 before any gets #2.
  // Track per-candidate cursor.
  const cursor = new Map<string, number>();
  for (const c of sorted) cursor.set(c.candidateId, 0);

  let activeCandidates = sorted.filter((c) => c.photoUrls.length > 0);
  while (out.length < total && activeCandidates.length > 0) {
    const stillActive: CandidatePhotoSource[] = [];
    for (const c of activeCandidates) {
      if (out.length >= total) break;
      const idx = cursor.get(c.candidateId)!;
      if (idx >= c.photoUrls.length) continue;
      out.push({
        compId: c.candidateId,
        url: c.photoUrls[idx],
        photoIndex: idx + 1,
      });
      cursor.set(c.candidateId, idx + 1);
      if (idx + 1 < c.photoUrls.length) stillActive.push(c);
    }
    activeCandidates = stillActive;
  }

  return out;
}
