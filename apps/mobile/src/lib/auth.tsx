import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, setAuthToken, setUnauthorizedHandler } from './api';
import { TOKEN_KEY, USER_KEY } from './config';

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  organizationId?: string | null;
  organization?: { id: string; name: string; plan?: string } | null;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore a stored session on launch.
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_KEY);
        if (stored) {
          setAuthToken(stored);
          setToken(stored);
          // Show the cached user instantly, then refresh from /auth/me (which
          // returns the full user incl. firstName + organization).
          const cached = await SecureStore.getItemAsync(USER_KEY);
          if (cached) setUser(JSON.parse(cached));
          const { data } = await api.get('/auth/me');
          const fresh = data?.user ?? data;
          if (fresh?.id) {
            setUser(fresh);
            await SecureStore.setItemAsync(USER_KEY, JSON.stringify(fresh));
          }
        }
      } catch {
        await clearSession();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Let a 401 anywhere in the app force a sign-out.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void clearSession();
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  async function clearSession() {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
  }

  async function signIn(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });
    const nextToken: string = data.token;
    setAuthToken(nextToken);
    await SecureStore.setItemAsync(TOKEN_KEY, nextToken);
    if (data.user) await SecureStore.setItemAsync(USER_KEY, JSON.stringify(data.user));
    setToken(nextToken);
    setUser(data.user ?? null);
  }

  async function signOut() {
    await clearSession();
  }

  const value = useMemo<AuthState>(
    () => ({ token, user, loading, signIn, signOut }),
    [token, user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
