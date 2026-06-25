import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Dealcore brand tokens. Brand color is teal #0D9488. Light + dark palettes share
 * the same keys; components read the active one via useColors() so they re-render
 * on theme change. `colors` (light) is exported as a static fallback for the few
 * non-component spots (e.g. default props).
 */
export const lightColors = {
  primary: '#0D9488',
  primaryDark: '#0F766E',
  primaryLight: '#14B8A6',
  primarySoft: '#CCFBF1',
  primaryTint: '#F0FDFA',
  primaryOnDark: '#5EEAD4',

  bg: '#F9FAFB',
  surface: '#FFFFFF',
  nav: '#0F172A',
  navOn: '#FFFFFF',

  text: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  onDarkMuted: '#94A3B8',

  border: '#E5E7EB',

  danger: '#DC2626',
  callAccept: '#16A34A',
  bubbleIn: '#F1F5F9',
};

export type Colors = typeof lightColors;

export const darkColors: Colors = {
  primary: '#2DD4BF',
  primaryDark: '#14B8A6',
  primaryLight: '#5EEAD4',
  primarySoft: '#0F3D38',
  primaryTint: '#0C2C29',
  primaryOnDark: '#5EEAD4',

  bg: '#0B1120',
  surface: '#172033',
  nav: '#0F172A',
  navOn: '#FFFFFF',

  text: '#F3F4F6',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  onDarkMuted: '#94A3B8',

  border: '#293548',

  danger: '#F87171',
  callAccept: '#22C55E',
  bubbleIn: '#293548',
};

/** Static light palette — for default props / non-component code only. */
export const colors = lightColors;

export const radius = { md: 12, lg: 16, pill: 28 };

export type ThemeMode = 'light' | 'dark' | 'system';
const MODE_KEY = 'dealcore.theme_mode';

interface ThemeContextValue {
  colors: Colors;
  mode: ThemeMode;
  scheme: 'light' | 'dark';
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: lightColors,
  mode: 'system',
  scheme: 'light',
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    SecureStore.getItemAsync(MODE_KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
    });
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    SecureStore.setItemAsync(MODE_KEY, m).catch(() => {});
  };

  const scheme: 'light' | 'dark' = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const value: ThemeContextValue = {
    colors: scheme === 'dark' ? darkColors : lightColors,
    mode,
    scheme,
    setMode,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Active palette for the current theme. */
export function useColors(): Colors {
  return useContext(ThemeContext).colors;
}

/** Theme mode controls + the resolved scheme. */
export function useThemeMode() {
  const { mode, setMode, scheme } = useContext(ThemeContext);
  return { mode, setMode, scheme };
}

/**
 * One-line themed styles: `const { colors, styles } = useThemed(makeStyles)` where
 * makeStyles is a module-level `(c: Colors) => StyleSheet.create({...})`.
 */
export function useThemed<T>(make: (c: Colors) => T): { colors: Colors; styles: T } {
  const colors = useColors();
  return useMemo(() => ({ colors, styles: make(colors) }), [colors, make]);
}
