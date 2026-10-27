'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { companiesAPI } from '@/lib/api';

/**
 * The companies a login can switch between (Quick Cash Home Buyers, D.I.G.
 * Deeper) and which one is selected. The selection only decides which
 * pipelines the menu shows; every page and the inbox still work for both.
 *
 * Kept in a module-level store rather than a provider because AppShell is
 * mounted per page: this way the list is fetched once per tab, not once per
 * navigation.
 */

export type ModuleKey = 'PROPERTY_LEADS' | 'FORECLOSURES' | 'PROBATE' | 'TAX_SALES' | 'SURPLUS_FUNDS';

export interface Company {
  id: string;
  key: string;
  legalName: string;
  name: string;
  modules: ModuleKey[];
}

/** Where each pipeline's board lives. */
export const MODULE_HREF: Record<ModuleKey, string> = {
  PROPERTY_LEADS: '/leads',
  FORECLOSURES: '/foreclosures',
  PROBATE: '/probate',
  TAX_SALES: '/tax-sales',
  SURPLUS_FUNDS: '/surplus-funds',
};

/**
 * A lead's pipeline, from its source. Same rule as the API's
 * PIPELINE_SOURCES: the four distress sources have their own board, and every
 * other source is a property lead.
 */
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

/**
 * The pipeline a page belongs to, when it belongs to exactly one. The lead
 * detail page (/leads/[id]) serves every pipeline, so only the list itself
 * counts as Property Leads; the lead page reports its own source instead.
 */
export function moduleForPath(pathname: string): ModuleKey | null {
  if (pathname === '/leads') return 'PROPERTY_LEADS';
  for (const [module, href] of Object.entries(MODULE_HREF) as [ModuleKey, string][]) {
    if (module === 'PROPERTY_LEADS') continue;
    if (pathname === href || pathname.startsWith(`${href}/`)) return module;
  }
  return null;
}

export function companyForModule(companies: Company[], module: ModuleKey): Company | null {
  return companies.find((c) => c.modules.includes(module)) || null;
}

// Store

const STORAGE_KEY = 'dealcore:company';

interface State {
  companies: Company[];
  currentKey: string | null;
  loaded: boolean;
}

let state: State = { companies: [], currentKey: null, loaded: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function readStoredKey(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function load() {
  if (loading) return loading;
  loading = companiesAPI
    .list()
    .then((res) => {
      const companies: Company[] = Array.isArray(res.data) ? res.data : [];
      const stored = state.currentKey ?? readStoredKey();
      const currentKey = companies.some((c) => c.key === stored) ? stored : companies[0]?.key ?? null;
      emit({ companies, currentKey, loaded: true });
    })
    .catch(() => {
      // No companies to show (signed out, or an older API): the menu falls
      // back to every pipeline, as before companies existed.
      emit({ loaded: true });
      loading = null;
    });
  return loading;
}

export function selectCompany(key: string) {
  if (key === state.currentKey) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {}
  emit({ currentKey: key });
}

/** Switch to whichever company runs this pipeline, if it is not the current one. */
export function followModule(module: ModuleKey | null) {
  if (!module) return;
  const owner = companyForModule(state.companies, module);
  if (owner) selectCompany(owner.key);
}

/** Forget the list and the choice on sign-out, so the next login loads its own. */
export function resetCompanies() {
  loading = null;
  emit({ companies: [], currentKey: null, loaded: false });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverState: State = { companies: [], currentKey: null, loaded: false };

export function useCompanies() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => serverState);
  useEffect(() => {
    load();
  }, []);

  const current = snapshot.companies.find((c) => c.key === snapshot.currentKey) || null;
  return {
    companies: snapshot.companies,
    current,
    loaded: snapshot.loaded,
    /** True when the login has more than one company, so a switcher is worth showing. */
    canSwitch: snapshot.companies.length > 1,
    /** Whether the menu should show this pipeline. Everything shows until companies load. */
    shows: (module: ModuleKey) => !current || current.modules.includes(module),
    companyForSource: (source?: string | null) =>
      companyForModule(snapshot.companies, moduleForSource(source)),
  };
}

/** Lead pages call this so opening a lead switches to the company that runs it. */
export function useFollowLeadSource(source?: string | null) {
  const { loaded } = useCompanies();
  useEffect(() => {
    if (loaded && source !== undefined) followModule(moduleForSource(source));
  }, [loaded, source]);
}

/** Pipeline pages switch to the company that runs them. */
export function useFollowPath(pathname: string) {
  const { loaded } = useCompanies();
  useEffect(() => {
    if (loaded) followModule(moduleForPath(pathname));
  }, [loaded, pathname]);
}
