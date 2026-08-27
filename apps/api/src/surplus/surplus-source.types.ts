/**
 * The contract every county surplus source implements.
 *
 * There is an interface here rather than a RealTDM client because the two
 * sources already in scope share nothing: RealTDM is form-encoded POSTs to
 * `/public/cases/*` returning HTML fragments, Duval is an ASP.NET app with a
 * jqGrid JSON endpoint and `/Home/Details?id=N` pages. Their document
 * vocabularies do not overlap at all.
 *
 * Adapters fetch and normalize. They do NOT classify, score, dedupe or write:
 * that belongs to surplus-classify.util.ts and SurplusIngestService, so a new
 * county is a parser plus a fixture and nothing else.
 */

/** One case as it appears on a county's search results list. */
export interface SurplusCaseSummary {
  /** The county's own id, used to fetch the detail page. */
  sourceCaseId: string;
  caseNumber: string;
  parcelId?: string | null;
  certificateNumber?: string | null;
  /** ISO date, or null when the source ships something unparseable. */
  saleDate?: string | null;
  /** The county's own status string, verbatim. */
  status?: string | null;
  /**
   * The surplus the county posts TODAY. Not evidence the money is still there:
   * Duval keeps posting the full amount after distribution. Only the document
   * list settles that.
   */
  surplus?: number | null;
  openingBid?: number | null;
  highBid?: number | null;
  /** Owners of record, already split and deduped. */
  owners: string[];
}

/** One document on a case docket, in filing order. */
export interface SurplusCaseDocument {
  title: string;
  docId?: string | null;
  url?: string | null;
  /** Only when the SOURCE puts the claimant in the title. Never inferred. */
  claimant?: string | null;
}

/** A case with everything the detail page adds. */
export interface SurplusCaseDetail extends SurplusCaseSummary {
  propertyAddress?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  propertyZip?: string | null;
  legalDescription?: string | null;
  applicantNames?: string | null;
  /** 'Improved' | 'Vacant' and whatever else a county uses. */
  assessedAs?: string | null;
  documents: SurplusCaseDocument[];
  sourceUrl: string;
}

export interface SurplusSourceAdapter {
  /** Stable id written to SurplusDetail.sourceSystem, eg 'duval_taxdeed'. */
  readonly key: string;
  /** The county this adapter covers, matching FL_COUNTIES. */
  readonly county: string;
  /**
   * Every case the county currently flags as carrying a surplus. Adapters
   * return everything and let the ingest apply the floor, so a run can report
   * how many it dropped rather than silently narrowing.
   */
  listSurplusCases(): Promise<SurplusCaseSummary[]>;
  /** The full docket for one case. */
  fetchCase(sourceCaseId: string): Promise<SurplusCaseDetail | null>;
}
