import Constants from 'expo-constants';

/**
 * API base URL. Set EXPO_PUBLIC_API_URL in the environment (or eas.json) for
 * builds; falls back to the value in app.json `extra.apiUrl`. Point this at the
 * Railway API domain.
 */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra?.apiUrl as string) ||
  'http://localhost:3001';

export const TOKEN_KEY = 'dealcore.auth_token';
export const USER_KEY = 'dealcore.auth_user';
