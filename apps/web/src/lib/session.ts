/**
 * Whether this browser already holds a token the API will accept, judged
 * without a round trip: it decodes, it has not expired, and it names an
 * organization (the API refuses org-less tokens since #126).
 *
 * The login page and the home page use it to send a signed-in user straight
 * on. Before, both always showed the sign-in form, so opening the bare site
 * address or reloading it looked exactly like being signed out, and an agent
 * working the board signed in again several times an evening while its token
 * was still good.
 *
 * The signature is not checked here and does not need to be. A token that
 * decodes but is forged or signed with an old secret gets a 401 on the first
 * API call, and the api.ts interceptor removes it and comes back to /login,
 * where this then returns false. So a bad token cannot loop.
 */
export function hasLiveToken(): boolean {
  if (typeof window === 'undefined') return false;
  const token = localStorage.getItem('auth_token');
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload || !payload.userId || !payload.organizationId) return false;
  // A minute of slack so a token about to lapse is not handed to a page that
  // would 401 a second later.
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() + 60_000) return false;
  return true;
}

function decodeJwtPayload(token: string): any | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}
