import { ForeclosureSourceKind } from '@fast-homes/shared';

/**
 * Normalized foreclosure lead as produced by any ingestion path (import, RSS,
 * PDF, manual) before it is written to Lead + ForeclosureDetail. Addresses and
 * owners may be partial; derived fields are computed in the service.
 */
export interface ForeclosureLeadInput {
  // Notice
  noticeType?: string;
  noticeUrl?: string;
  noticeId?: string;
  caseNumber?: string;
  county?: string;
  trustee?: string;
  rawSnippet?: string;
  sourceKind: ForeclosureSourceKind;

  // Property
  address?: string;
  city?: string;
  state?: string;
  zip?: string;

  // Owner / contact
  ownerNames?: string;
  countyOwner?: string;
  phone1?: string;
  phone2?: string;
  phone1Type?: string;
  phone2Type?: string;
  email?: string;
  ownerOccupied?: string; // 'Y' | 'N'
  mailingAddress?: string;
  mailCity?: string;
  mailState?: string;
  mailZip?: string;
  skipStatus?: string;

  // Facts
  saleDate?: string; // ISO or raw; normalized in service
  hearingDate?: string;
  loanDate?: string;
  loanAmount?: number | null;
  assessedValue?: number | null;
  equityPct?: number | null;

  // Pre-set values (import brings these from the sheet)
  priority?: string;
  notes?: string;
  dateAdded?: string;
}

export interface ForeclosureListFilters {
  organizationId?: string;
  search?: string;
  priority?: string;
  noticeType?: string;
  workStatus?: string;
  occupancy?: string; // 'owner' | 'absentee'
  equityMin?: number;
  saleWithinDays?: number;
  sort?: string; // 'sale' | 'score' | 'equity' | 'added'
  includeDead?: boolean;
  page?: number;
  pageSize?: number;
}
