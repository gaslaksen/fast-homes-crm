import { SurplusService } from './surplus.service';

/**
 * The letter clock belongs to the claimant. Mailing a living claimant's son
 * used to reset it, so the board stopped saying the claimant was due.
 */
const service = new SurplusService({} as any, {} as any, {} as any, {} as any);
const letterState = (d: any) => (service as any).letterState(d);

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const claimantLetter = { id: 'l1', mailedAt: daysAgo(30), mailType: 'standard', heirId: null };
const sonLetter = { id: 'l2', mailedAt: daysAgo(2), mailType: 'standard', heirId: 'heir-son' };

describe('SurplusService letter clock', () => {
  it('ignores a letter to a relative when the claimant is alive', () => {
    const s = letterState({ ownerMailingStreet: '1 Main St', letters: [sonLetter, claimantLetter] });
    expect(s.letterDue).toBe(true);
    expect(s.letterCount).toBe(2);
  });

  it('counts the heirs\' letters when the claimant has died', () => {
    const s = letterState({ ownerMailingStreet: '1 Main St', deceased: true, letters: [sonLetter, claimantLetter] });
    expect(s.letterDue).toBe(false);
  });

  it('is not due when the claimant was written to recently', () => {
    const s = letterState({ ownerMailingStreet: '1 Main St', letters: [{ ...claimantLetter, mailedAt: daysAgo(3) }] });
    expect(s.letterDue).toBe(false);
  });
});
