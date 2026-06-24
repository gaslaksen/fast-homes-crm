import axios from 'axios';
import { API_URL } from './config';

/**
 * Shared axios instance. The bearer token is held in memory (set by AuthContext
 * after it loads from SecureStore) so every request is authenticated without an
 * async read per call. A 401 triggers the registered unauthorized handler, which
 * the auth layer uses to log the user out.
 */
export const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
});

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/** The current bearer token — needed to sign media proxy URLs (e.g. recordings). */
export function getAuthToken(): string | null {
  return authToken;
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

api.interceptors.request.use((cfg) => {
  if (authToken) {
    cfg.headers.Authorization = `Bearer ${authToken}`;
  }
  return cfg;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);
