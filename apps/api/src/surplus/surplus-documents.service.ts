/**
 * The document set on a surplus claim.
 *
 * One row per kind per claim is the checklist; a file attached to the row
 * is the document. The course's point is that a file is provably complete
 * before it is submitted, not assumed complete, so the checklist is
 * computed against what THIS claim needs (an estate needs the death
 * certificate and letters, an entity needs its papers) and says exactly
 * what is still missing.
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { complianceGate } from './surplus.util';
import {
  LeadSource,
  SurplusDocumentKind,
  SurplusDocumentStatus,
  SURPLUS_DOCUMENT_LABEL,
  SURPLUS_DOCUMENT_SET,
  SURPLUS_DOCUMENT_STATUS_LABEL,
  SURPLUS_DOCUMENT_TEMPLATE,
  surplusDocumentCollected,
  surplusDocumentsRequired,
  SURPLUS_RETIRED_DOCUMENT_KINDS,
} from '@fast-homes/shared';

const KINDS = Object.values(SurplusDocumentKind) as string[];
const STATUSES = Object.values(SurplusDocumentStatus) as string[];

/** What can be uploaded. Scans and photos of paper, nothing executable. */
export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'];
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

/** The order at the notary table: retention first, then the package. Read by the signing-order gate. */
export const SIGNING_ORDER: SurplusDocumentKind[] = [
  SurplusDocumentKind.FEE_AGREEMENT,
  SurplusDocumentKind.LIMITED_POA,
  SurplusDocumentKind.LETTER_OF_DIRECTION,
  SurplusDocumentKind.COUNTY_CLAIM_FORM,
];

export interface DocumentRow {
  id: string | null;
  kind: string;
  label: string;
  docSet: string;
  status: string;
  statusLabel: string;
  collected: boolean;
  required: boolean;
  hasFile: boolean;
  fileName: string | null;
  contentType: string | null;
  size: number | null;
  templateKind: string | null;
  templateVersion: number | null;
  /** Whether this kind is generated from a template at all. */
  hasTemplate: boolean;
  /** The template's active version, to compare against templateVersion. */
  templateActiveVersion: number | null;
  /** Built from a template that has since been revised. */
  templateStale: boolean;
  signedAt: Date | null;
  notarizedAt: Date | null;
  filedAt: Date | null;
  note: string | null;
  updatedAt: Date | null;
}

export interface DocumentChecklist {
  documents: DocumentRow[];
  required: string[];
  missing: string[];
  complete: boolean;
  storageConfigured: boolean;
}

@Injectable()
export class SurplusDocumentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  private kindOf(raw: string): SurplusDocumentKind {
    if (KINDS.includes(raw)) return raw as SurplusDocumentKind;
    throw new BadRequestException(`Unknown document kind: ${raw}`);
  }

  private async detailFor(leadId: string, organizationId?: string | null) {
    const lead = await this.prisma.lead.findFirst({
      where: {
        id: leadId,
        source: LeadSource.SURPLUS,
        ...(organizationId ? { organizationId } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        sellerFirstName: true,
        sellerLastName: true,
        surplusDetail: {
          select: {
          id: true,
          deceased: true,
          heirsRequired: true,
          claimantType: true,
          documents: true,
          // For the compliance gate on sending the fee agreement.
          surplusType: true,
          fundLocation: true,
          grossSurplus: true,
          liens: true,
          noticeDate: true,
          noticeConfirmed: true,
          certOfDisbursements: true,
          totalConsideration: true,
          licensedRepId: true,
          disclosures: true,
        },
        },
      },
    });
    if (!lead?.surplusDetail) throw new BadRequestException('Surplus lead not found');
    return lead;
  }

  /**
   * The checklist for one claim, built from the rows that exist and the
   * kinds the claim needs. Pure, so the list endpoint and the row builder
   * agree.
   */
  checklist(
    rows: any[],
    facts: { deceased: boolean; isEntity: boolean },
    /** Active template version per template kind, for the stale flag. */
    activeVersions: Record<string, number> = {},
  ): Omit<DocumentChecklist, 'storageConfigured'> {
    const required = surplusDocumentsRequired(facts);
    const byKind = new Map<string, any>(rows.map((r) => [r.kind, r]));
    // A retired kind stays on the list only while a claim still carries
    // something on it (a file, or a status past outstanding), so old rows
    // read and new claims never see it.
    const kinds = (Object.values(SurplusDocumentKind) as SurplusDocumentKind[]).filter((kind) => {
      if (!SURPLUS_RETIRED_DOCUMENT_KINDS.includes(kind)) return true;
      const r = byKind.get(kind);
      return !!r && (!!r.fileKey || (r.status && r.status !== SurplusDocumentStatus.OUTSTANDING));
    });
    const documents: DocumentRow[] = kinds.map((kind) => {
      const r = byKind.get(kind) || null;
      const status = r?.status || SurplusDocumentStatus.OUTSTANDING;
      const templateKind = SURPLUS_DOCUMENT_TEMPLATE[kind] || null;
      const activeVersion = templateKind ? activeVersions[templateKind] ?? null : null;
      // Stale means the wording moved on after this copy was built. Only a
      // copy that was built from a template can be stale; one uploaded from
      // paper has no version to compare.
      const templateStale =
        !!templateKind && r?.templateVersion != null && activeVersion != null && r.templateVersion < activeVersion;
      return {
        hasTemplate: !!templateKind,
        templateActiveVersion: activeVersion,
        templateStale,
        id: r?.id || null,
        kind,
        label: SURPLUS_DOCUMENT_LABEL[kind],
        docSet: SURPLUS_DOCUMENT_SET[kind],
        status,
        statusLabel: SURPLUS_DOCUMENT_STATUS_LABEL[status as SurplusDocumentStatus] || status,
        collected: surplusDocumentCollected(status),
        required: required.includes(kind),
        hasFile: !!r?.fileKey,
        fileName: r?.fileName || null,
        contentType: r?.contentType || null,
        size: r?.size ?? null,
        templateKind: r?.templateKind || null,
        templateVersion: r?.templateVersion ?? null,
        signedAt: r?.signedAt || null,
        notarizedAt: r?.notarizedAt || null,
        filedAt: r?.filedAt || null,
        note: r?.note || null,
        updatedAt: r?.updatedAt || null,
      };
    });
    const missing = required.filter((k) => !documents.find((d) => d.kind === k)?.collected);
    return { documents, required, missing, complete: missing.length === 0 };
  }

  async list(leadId: string, organizationId?: string | null, facts?: { deceased: boolean; isEntity: boolean }) {
    const lead = await this.detailFor(leadId, organizationId);
    const d = lead.surplusDetail!;
    const f = facts || {
      deceased: !!(d.deceased || d.heirsRequired),
      isEntity: d.claimantType === 'lienholder' ? false : /\b(LLC|INC|CORP|TRUST|ESTATE|COMPANY|LTD)\b/i.test(`${lead.sellerFirstName} ${lead.sellerLastName}`),
    };
    return { ...this.checklist(d.documents, f), storageConfigured: this.storage.configured() };
  }

  /** Attach a file to a kind, replacing any file already on it. */
  async upload(
    leadId: string,
    rawKind: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    opts: { status?: string | null; note?: string | null },
    organizationId?: string | null,
    userId?: string | null,
  ) {
    const kind = this.kindOf(rawKind);
    if (!DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Upload a PDF or an image (JPEG, PNG, HEIC, WebP).');
    }
    if (file.size > DOCUMENT_MAX_BYTES) throw new BadRequestException('That file is over 20 MB.');
    const lead = await this.detailFor(leadId, organizationId);
    const d = lead.surplusDetail!;

    const key = this.storage.keyFor(['surplus', lead.organizationId, d.id, kind], file.originalname);
    await this.storage.put(key, file.buffer, file.mimetype);

    const existing = d.documents.find((x: any) => x.kind === kind) || null;
    if (existing?.fileKey && existing.fileKey !== key) await this.storage.remove(existing.fileKey);

    // A fresh upload with no status given is at least received: somebody
    // has the paper. A signed status passed in stays.
    const status =
      opts.status && STATUSES.includes(opts.status)
        ? opts.status
        : existing && surplusDocumentCollected(existing.status)
          ? existing.status
          : SurplusDocumentStatus.RECEIVED;

    const data = {
      status,
      fileKey: key,
      fileName: file.originalname,
      contentType: file.mimetype,
      size: file.size,
      note: (opts.note || '').trim() || existing?.note || null,
      uploadedByUserId: userId || null,
      ...this.stampFor(status),
    };
    const row = existing
      ? await this.prisma.surplusDocument.update({ where: { id: existing.id }, data })
      : await this.prisma.surplusDocument.create({
          data: {
            surplusDetailId: d.id,
            organizationId: lead.organizationId,
            kind,
            docSet: SURPLUS_DOCUMENT_SET[kind],
            ...data,
          },
        });

    await this.prisma.activity.create({
      data: {
        leadId,
        userId: userId || undefined,
        type: 'DOCUMENT_UPLOADED',
        description: `${SURPLUS_DOCUMENT_LABEL[kind]} uploaded (${file.originalname})`,
        metadata: { kind, status, fileName: file.originalname, size: file.size },
      },
    });
    return row;
  }

  /** Move a document's status, with or without a file. The checklist can be ticked from paper. */
  async setStatus(
    leadId: string,
    rawKind: string,
    input: {
      status: string;
      note?: string | null;
      signedAt?: string | null;
      /** The template and version the document was built from, when it was. */
      templateKind?: string | null;
      templateVersion?: number | null;
    },
    organizationId?: string | null,
    userId?: string | null,
  ) {
    const kind = this.kindOf(rawKind);
    if (!STATUSES.includes(input.status)) throw new BadRequestException(`Unknown status: ${input.status}`);
    const lead = await this.detailFor(leadId, organizationId);
    const d = lead.surplusDetail!;
    const existing = d.documents.find((x: any) => x.kind === kind) || null;

    // The compliance gate guards the SEND of the fee agreement, which is the
    // act that puts a contract in front of a claimant. A contract over the
    // Florida cap or missing a required disclosure is void, so it does not
    // go out. Recording that one was signed on paper is not blocked here;
    // the stage gate refuses Agreement Signed with the same reasons.
    if (kind === SurplusDocumentKind.FEE_AGREEMENT && input.status === SurplusDocumentStatus.SENT) {
      const blocks = complianceGate({
        surplusType: d.surplusType,
        fundLocation: d.fundLocation,
        grossSurplus: d.grossSurplus,
        liens: (d.liens as any) || [],
        noticeDate: d.noticeDate,
        noticeConfirmed: d.noticeConfirmed,
        certOfDisbursements: d.certOfDisbursements,
        totalConsideration: d.totalConsideration,
        licensedRepId: d.licensedRepId,
        disclosures: (d.disclosures as Record<string, boolean>) || {},
      }).blocks;
      if (blocks.length) {
        throw new BadRequestException(`The fee agreement cannot be sent: ${blocks.join('; ')}`);
      }
    }
    const data: any = {
      status: input.status,
      note: input.note !== undefined ? (input.note || '').trim() || null : undefined,
      ...(input.templateKind ? { templateKind: input.templateKind } : {}),
      ...(input.templateVersion != null ? { templateVersion: Number(input.templateVersion) } : {}),
      ...this.stampFor(input.status, input.signedAt ? new Date(input.signedAt) : undefined),
    };
    const row = existing
      ? await this.prisma.surplusDocument.update({ where: { id: existing.id }, data })
      : await this.prisma.surplusDocument.create({
          data: {
            surplusDetailId: d.id,
            organizationId: lead.organizationId,
            kind,
            docSet: SURPLUS_DOCUMENT_SET[kind],
            ...data,
          },
        });
    await this.prisma.activity.create({
      data: {
        leadId,
        userId: userId || undefined,
        type: 'DOCUMENT_STATUS',
        description: `${SURPLUS_DOCUMENT_LABEL[kind]}: ${SURPLUS_DOCUMENT_STATUS_LABEL[input.status as SurplusDocumentStatus]}`,
        metadata: { kind, status: input.status },
      },
    });
    return row;
  }

  /** The dates a status implies, set once and never cleared by a later move. */
  private stampFor(status: string, at: Date = new Date()) {
    const out: any = {};
    if (status === SurplusDocumentStatus.SIGNED || status === SurplusDocumentStatus.NOTARIZED || status === SurplusDocumentStatus.FILED) {
      out.signedAt = at;
    }
    if (status === SurplusDocumentStatus.NOTARIZED || status === SurplusDocumentStatus.FILED) out.notarizedAt = at;
    if (status === SurplusDocumentStatus.FILED) out.filedAt = at;
    return out;
  }

  async signedUrl(docId: string, organizationId?: string | null): Promise<{ url: string; fileName: string | null }> {
    const row = await this.prisma.surplusDocument.findFirst({
      where: { id: docId, ...(organizationId ? { organizationId } : {}) },
    });
    if (!row) throw new BadRequestException('Document not found');
    if (!row.fileKey) throw new BadRequestException('No file is attached to this document.');
    return { url: await this.storage.signedUrl(row.fileKey, row.fileName), fileName: row.fileName };
  }

  /** Detach the file and reset the row to outstanding. The row itself stays as the checklist entry. */
  async remove(docId: string, organizationId?: string | null, userId?: string | null) {
    const row = await this.prisma.surplusDocument.findFirst({
      where: { id: docId, ...(organizationId ? { organizationId } : {}) },
      include: { surplusDetail: { select: { leadId: true } } },
    });
    if (!row) throw new BadRequestException('Document not found');
    if (row.fileKey) await this.storage.remove(row.fileKey);
    await this.prisma.surplusDocument.update({
      where: { id: row.id },
      data: {
        status: SurplusDocumentStatus.OUTSTANDING,
        fileKey: null,
        fileName: null,
        contentType: null,
        size: null,
        signedAt: null,
        notarizedAt: null,
        filedAt: null,
      },
    });
    await this.prisma.activity.create({
      data: {
        leadId: row.surplusDetail.leadId,
        userId: userId || undefined,
        type: 'DOCUMENT_REMOVED',
        description: `${SURPLUS_DOCUMENT_LABEL[row.kind as SurplusDocumentKind] || row.kind} removed`,
        metadata: { kind: row.kind },
      },
    });
    return { removed: 1 };
  }
}
