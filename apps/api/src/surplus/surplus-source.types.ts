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
  /**
   * A durable link, when the county has one. Null on sources whose links
   * expire (RealTDM hands out pre-signed S3 URLs good for under an hour), in
   * which case the adapter's resolveDocumentUrl mints one on demand.
   */
  url?: string | null;
  /** Only when the SOURCE puts the claimant in the title. Never inferred. */
  claimant?: string | null;
  /** ISO date the county filed it, when the county publishes one. */
  filedAt?: string | null;
  fileName?: string | null;
  /** The county's own document type token, needed to mint a link. */
  docType?: string | null;
}

/** One party of record, with the mailing address the county holds for them. */
export interface SurplusCaseParty {
  name: string;
  /** The county's own role label, verbatim and uppercased: OWNER, LIEN HOLDER, APPLICANT. */
  role: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country?: string | null;
}

/**
 * One addressee of the clerk's surplus letter, from the county's own mailing
 * record. Where a source publishes this, it replaces reading the scanned
 * notice with vision.
 */
export interface SurplusNoticeRecipient {
  name: string;
  role?: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  /** "Certified Mail" and the like, as the county records it. */
  delivery?: string | null;
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
  /** Every party of record, when the source lists them with addresses. */
  parties?: SurplusCaseParty[];
  /**
   * Who the surplus letter was mailed to, when the source records it. Present
   * means the ingest need not read the notice document at all.
   */
  noticeRecipients?: SurplusNoticeRecipient[];
  /** ISO date the surplus letter was filed, when the source publishes it. */
  noticeDate?: string | null;
  /** The surplus as stated in the letter, when the source lets us read it. */
  surplusAtNotice?: number | null;
}

/** How often a source is polled. Set per adapter, honoured by SurplusPollService. */
export type SurplusPollCadence = 'daily' | 'weekly';

export interface SurplusSourceAdapter {
  /** Stable id written to SurplusDetail.sourceSystem, eg 'duval_taxdeed'. */
  readonly key: string;
  /** The county this adapter covers, matching FL_COUNTIES. */
  readonly county: string;
  readonly cadence: SurplusPollCadence;
  /** Courtesy pause between detail fetches, in ms. */
  readonly detailDelayMs: number;
  /**
   * Whether a fee receipt with no claim document beside it means a claim was
   * filed. True where every receipt observed sat on a claimed case (Lee),
   * false where receipts appear on open cases too (Duval). See classifyCase.
   */
  readonly receiptsImplyClaim?: boolean;
  /**
   * Every case the county currently flags as carrying a surplus. Adapters
   * return everything and let the ingest apply the floor, so a run can report
   * how many it dropped rather than silently narrowing.
   */
  listSurplusCases(): Promise<SurplusCaseSummary[]>;
  /** Whether a list row still holds money and is worth a detail fetch. */
  isLive(summary: SurplusCaseSummary): boolean;
  /** The full docket for one case. */
  fetchCase(sourceCaseId: string): Promise<SurplusCaseDetail | null>;
  /**
   * A fresh link to one document, for sources whose stored links expire.
   * Absent on sources whose ledger URLs are durable.
   */
  resolveDocumentUrl?(doc: Pick<SurplusCaseDocument, 'docId' | 'docType'>): Promise<string | null>;
}
