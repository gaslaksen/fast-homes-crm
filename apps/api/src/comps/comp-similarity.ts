/**
 * Provider-agnostic comp similarity scoring. Used by both REAPI and BatchData
 * comp fetchers so correlation values are directly comparable across providers
 * in the side-by-side comparison view.
 *
 * Scoring weights (out of ~100):
 *   - Bedrooms:   up to 25 (exact match = 25, ±1 = 15, ±2 = 5)
 *   - Bathrooms:  up to 25 (exact = 25, ±0.5 = 20, ±1 = 10, ±1.5 = 5)
 *   - Sqft:       up to 40 — most important (pct diff: ≤5%=40, ≤10%=35, ≤15%=25, ≤20%=15, ≤30%=5)
 *   - PropertyType: 10 if exact match
 *
 * Returns null if neither subject nor comp have enough data to score on any
 * dimension — caller should treat as "no signal" rather than "100% match".
 */
export function computeSimilarityScore(
  subject: { bedrooms?: number | null; bathrooms?: number | null; sqft?: number | null; propertyType?: string | null },
  comp: { bedrooms?: number | null; bathrooms?: number | null; sqft?: number | null; propertyType?: string | null },
): number | null {
  let score = 0;
  let touched = false;

  if (subject.bedrooms != null && comp.bedrooms != null) {
    touched = true;
    const diff = Math.abs(subject.bedrooms - comp.bedrooms);
    if (diff === 0) score += 25;
    else if (diff === 1) score += 15;
    else if (diff === 2) score += 5;
  }

  if (subject.bathrooms != null && comp.bathrooms != null) {
    touched = true;
    const diff = Math.abs(subject.bathrooms - comp.bathrooms);
    if (diff === 0) score += 25;
    else if (diff <= 0.5) score += 20;
    else if (diff <= 1) score += 10;
    else if (diff <= 1.5) score += 5;
  }

  if (subject.sqft && comp.sqft && subject.sqft > 0) {
    touched = true;
    const pctDiff = (Math.abs(subject.sqft - comp.sqft) / subject.sqft) * 100;
    if (pctDiff <= 5) score += 40;
    else if (pctDiff <= 10) score += 35;
    else if (pctDiff <= 15) score += 25;
    else if (pctDiff <= 20) score += 15;
    else if (pctDiff <= 30) score += 5;
  }

  if (subject.propertyType && comp.propertyType) {
    touched = true;
    if (subject.propertyType.toLowerCase() === comp.propertyType.toLowerCase()) score += 10;
  }

  if (!touched) return null;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Haversine distance between two lat/lng points in miles. Used as a fallback
 * when a provider doesn't return distance directly.
 */
export function haversineMiles(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
