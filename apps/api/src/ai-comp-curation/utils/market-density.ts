// Crude state-based proxy for market density. Good enough for v1 — used
// to pick the default radius and the expansion ladder. The AI's expansion
// narrative is the user-facing source of truth; this just picks where to
// start.

export type Density = 'urban' | 'suburban' | 'rural';

const RURAL_STATES = new Set([
  'AK', 'AL', 'AR', 'IA', 'ID', 'KS', 'KY', 'LA', 'ME', 'MS',
  'MT', 'NE', 'NM', 'ND', 'OK', 'SD', 'TN', 'VT', 'WV', 'WY',
]);

const URBAN_ZIP3 = new Set([
  // NYC, Boston, Philly, DC, Chicago, LA, SF, Miami, Seattle (rough)
  '100', '101', '102', '103', '104',
  '021', '022',
  '191', '192',
  '200', '202', '203', '204', '205',
  '606', '607', '608',
  '900', '902', '903', '904', '907', '908',
  '941', '942',
  '331',
  '981',
]);

export interface DensityInput {
  state: string | null | undefined;
  zip: string | null | undefined;
}

export function deriveDensity(input: DensityInput): Density {
  const zip3 = (input.zip || '').slice(0, 3);
  if (URBAN_ZIP3.has(zip3)) return 'urban';
  const state = (input.state || '').trim().toUpperCase();
  if (RURAL_STATES.has(state)) return 'rural';
  return 'suburban';
}

export interface ExpansionLadder {
  initial: number;
  tiers: number[];
}

const LADDERS: Record<Density, ExpansionLadder> = {
  urban: { initial: 0.5, tiers: [0.5, 1, 2] },
  suburban: { initial: 1.5, tiers: [1.5, 3, 5] },
  rural: { initial: 3, tiers: [3, 5, 7, 10] },
};

export function ladderFor(density: Density): ExpansionLadder {
  return LADDERS[density];
}
