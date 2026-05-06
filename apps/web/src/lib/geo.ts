// Haversine distance in miles between two lat/lng points. Mirrors
// apps/api/src/comps/comp-similarity.ts:haversineMiles so a comp's
// computed distance is identical whether the value came from the
// backend persistence or was filled in client-side.
//
// Used as a fallback display when a Comp row has distance=0 but valid
// coords on both subject and comp — most often REAPI MLS rows
// persisted before the backend's haversine fallback shipped.

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
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Given a comp + subject, return the comp's distance with a haversine
// fallback applied when the persisted distance is 0/missing and both
// sides have valid coords. Pass-through for everything else.
export function compDistance(
  comp: {
    distance?: number | null;
    latitude?: number | null;
    longitude?: number | null;
  },
  subject: { latitude?: number | null; longitude?: number | null } | null | undefined,
): number {
  const stored = comp.distance;
  if (typeof stored === 'number' && stored > 0) return stored;
  if (
    !subject ||
    typeof subject.latitude !== 'number' ||
    typeof subject.longitude !== 'number' ||
    typeof comp.latitude !== 'number' ||
    typeof comp.longitude !== 'number'
  ) {
    return typeof stored === 'number' ? stored : 0;
  }
  return haversineMiles(
    { latitude: subject.latitude, longitude: subject.longitude },
    { latitude: comp.latitude, longitude: comp.longitude },
  );
}
