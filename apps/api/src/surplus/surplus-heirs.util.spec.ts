import { heirRow, phoneTail } from './surplus-heirs.util';

/**
 * A number marked wrong or disconnected stays on the person, flagged, but
 * stops making them callable, so a dead number cannot hold a claim in Call now.
 */
describe('heirRow and bad numbers', () => {
  const son = { id: 'h1', name: 'Robert Kessler', role: 'relative', phone1: '4045550102', phone2: '(404) 555-0177' };

  it('flags a bad number and does not count it as callable', () => {
    const row = heirRow({ ...son, phone2: null }, new Set([phoneTail('+14045550102')]));
    expect(row.phones[0].bad).toBe(true);
    expect(row.cleanPhoneCount).toBe(0);
    expect(row.callable).toBe(false);
  });

  it('keeps the person callable on their other number', () => {
    const row = heirRow(son, new Set(['4045550102']));
    expect(row.phones.map((p) => p.bad)).toEqual([true, false]);
    expect(row.callable).toBe(true);
  });

  it('reads as before when no bad numbers are passed', () => {
    expect(heirRow(son).cleanPhoneCount).toBe(2);
  });
});
