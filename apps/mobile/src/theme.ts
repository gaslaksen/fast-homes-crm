/**
 * Dealcore brand tokens, matched to the web app (apps/web tailwind.config.js).
 * Brand color is teal #0D9488 (primary-600). Light surfaces, dark-navy nav,
 * matching the web's light theme + dark sidebar.
 */
export const colors = {
  // Brand (teal)
  primary: '#0D9488', // primary-600 — buttons, links, active states
  primaryDark: '#0F766E', // primary-700 — pressed
  primaryLight: '#14B8A6', // primary-500 — on dark backgrounds
  primarySoft: '#CCFBF1', // primary-100 — avatar/fills
  primaryTint: '#F0FDFA', // primary-50 — lightest wash

  // Surfaces
  bg: '#F9FAFB', // app background (gray-50)
  surface: '#FFFFFF', // cards
  nav: '#0F172A', // dark headers / nav
  navOn: '#FFFFFF',

  // Text
  text: '#111827', // gray-900
  textSecondary: '#6B7280', // gray-500
  textMuted: '#9CA3AF', // gray-400
  onDarkMuted: '#94A3B8', // muted text on the navy nav/login

  // Lines
  border: '#E5E7EB', // gray-200

  // Semantic
  danger: '#DC2626', // red-600 — end call / sign out
  callAccept: '#16A34A', // green-600 — start call
  bubbleIn: '#F1F5F9', // inbound message bubble
};

export const radius = {
  md: 12,
  lg: 16,
  pill: 28,
};
