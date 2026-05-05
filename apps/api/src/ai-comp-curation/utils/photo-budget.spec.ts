import { selectPhotoBudget, CandidatePhotoSource } from './photo-budget';

const c = (
  id: string,
  photos: number,
  uncertainty: number,
  distance: number,
): CandidatePhotoSource => ({
  candidateId: id,
  photoUrls: Array.from({ length: photos }, (_, i) => `https://x/${id}/${i}`),
  uncertainty,
  distance,
});

describe('selectPhotoBudget', () => {
  it('takes up to subjectMax subject photos first', () => {
    const out = selectPhotoBudget(['s1', 's2', 's3', 's4', 's5', 's6'], []);
    expect(out.filter((a) => a.compId === null)).toHaveLength(4);
  });

  it('respects total budget across subject + candidates', () => {
    const cands = [c('a', 5, 0.5, 1), c('b', 5, 0.5, 1)];
    const out = selectPhotoBudget(['s1', 's2'], cands, { total: 6 });
    expect(out).toHaveLength(6);
    expect(out.filter((a) => a.compId === null)).toHaveLength(2);
    expect(out.filter((a) => a.compId === 'a')).toHaveLength(2);
    expect(out.filter((a) => a.compId === 'b')).toHaveLength(2);
  });

  it('every candidate gets photo 1 before any gets photo 2', () => {
    const cands = [c('a', 5, 0.9, 1), c('b', 5, 0.9, 1), c('c', 5, 0.9, 1)];
    const out = selectPhotoBudget([], cands, { total: 4 });
    // First 3 must each be candidate's photo #1
    const firstThree = out.slice(0, 3);
    expect(new Set(firstThree.map((a) => a.compId)).size).toBe(3);
    expect(firstThree.every((a) => a.photoIndex === 1)).toBe(true);
    // 4th can be any candidate's photo #2
    expect(out[3].photoIndex).toBe(2);
  });

  it('orders candidates by uncertainty desc, then distance asc', () => {
    const cands = [
      c('far_low', 1, 0.2, 5),
      c('near_high', 1, 0.9, 0.5),
      c('near_low', 1, 0.2, 0.5),
      c('far_high', 1, 0.9, 5),
    ];
    const out = selectPhotoBudget([], cands, { total: 4 });
    expect(out.map((a) => a.compId)).toEqual([
      'near_high',
      'far_high',
      'near_low',
      'far_low',
    ]);
  });

  it('skips candidates with no photos', () => {
    const cands = [c('a', 0, 0.9, 1), c('b', 2, 0.9, 1)];
    const out = selectPhotoBudget([], cands, { total: 5 });
    expect(out.every((a) => a.compId === 'b')).toBe(true);
    expect(out).toHaveLength(2);
  });

  it('returns empty when no inputs', () => {
    expect(selectPhotoBudget([], [])).toEqual([]);
  });
});
