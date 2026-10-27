import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { COMPANY_KEY } from '@/lib/config';

/**
 * The companies a login can switch between (Quick Cash Home Buyers, D.I.G.
 * Deeper) and which one is selected. The selection decides what Home and the
 * Leads tab show; the Inbox, calls and texts keep working for both.
 *
 * Same rules as the web app (apps/web/src/lib/companies.ts). If the list
 * cannot load, nothing is selected and every screen shows what it did before
 * companies existed.
 */

export type ModuleKey = 'PROPERTY_LEADS' | 'FORECLOSURES' | 'PROBATE' | 'TAX_SALES' | 'SURPLUS_FUNDS';

export interface Company {
  id: string;
  key: string;
  legalName: string;
  name: string;
  modules: ModuleKey[];
}

/** A lead's pipeline, from its source. Every other source is a property lead. */
export function moduleForSource(source?: string | null): ModuleKey {
  switch (source) {
    case 'SURPLUS':
      return 'SURPLUS_FUNDS';
    case 'FORECLOSURE':
      return 'FORECLOSURES';
    case 'PROBATE':
      return 'PROBATE';
    case 'TAX_SALE':
      return 'TAX_SALES';
    default:
      return 'PROPERTY_LEADS';
  }
}

interface CompanyState {
  companies: Company[];
  current: Company | null;
  /** True when the login has more than one company, so a switcher is worth showing. */
  canSwitch: boolean;
  select: (key: string) => void;
  /** Whether the selected company runs this pipeline. True when none is selected. */
  shows: (module: ModuleKey) => boolean;
  /** Switch to whichever company runs this pipeline. */
  follow: (module: ModuleKey) => void;
  companyForSource: (source?: string | null) => Company | null;
}

const CompanyContext = createContext<CompanyState | undefined>(undefined);

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuth();
  const [storedKey, setStoredKey] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['companies', token],
    enabled: !!token,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data } = await api.get<Company[]>('/companies');
      return Array.isArray(data) ? data : [];
    },
  });
  const companies = token ? data ?? [] : [];

  // The last choice survives a restart. Signing out forgets it, so the next
  // login starts from its own first company. While the session is still
  // loading there is no token yet, and that is not a sign-out.
  useEffect(() => {
    if (loading) return;
    if (token) {
      SecureStore.getItemAsync(COMPANY_KEY).then(setStoredKey).catch(() => {});
    } else {
      setStoredKey(null);
      SecureStore.deleteItemAsync(COMPANY_KEY).catch(() => {});
    }
  }, [token, loading]);

  const select = useCallback((key: string) => {
    setStoredKey(key);
    SecureStore.setItemAsync(COMPANY_KEY, key).catch(() => {});
  }, []);

  const value = useMemo<CompanyState>(() => {
    const current = companies.find((c) => c.key === storedKey) || companies[0] || null;
    const companyFor = (module: ModuleKey) => companies.find((c) => c.modules.includes(module)) || null;
    return {
      companies,
      current,
      canSwitch: companies.length > 1,
      select,
      shows: (module) => !current || current.modules.includes(module),
      follow: (module) => {
        const owner = companyFor(module);
        if (owner && owner.key !== current?.key) select(owner.key);
      },
      companyForSource: (source) => companyFor(moduleForSource(source)),
    };
  }, [companies, storedKey, select]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany(): CompanyState {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within CompanyProvider');
  return ctx;
}
