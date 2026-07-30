import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ForeclosureExtractService } from './foreclosure-extract.service';
import {
  extractionToRow,
  applyVerifiedFieldGuard,
  mergeConfidence,
  isFilingColumn,
} from './foreclosure-filing-merge.util';

/**
 * Owns the ~25 structured fields for a filing: extracting them, persisting
 * them, and letting a user correct one without a later re-extraction undoing
 * the correction.
 *
 * Auto-persist, no save button - consistent with the rest of the app.
 */
@Injectable()
export class ForeclosureFilingService {
  private readonly logger = new Logger(ForeclosureFilingService.name);

  constructor(
    private prisma: PrismaService,
    private extract: ForeclosureExtractService,
  ) {}

  /**
   * Extract a document's filing fields and store them. Safe to re-run: the row
   * is keyed on documentId and updated in place, with verified fields left
   * untouched. Returns null when extraction is unavailable or fails.
   */
  async extractAndStore(
    documentId: string,
    text: string,
    opts: { organizationId?: string | null; leadId?: string | null },
  ) {
    const result = await this.extract.extractFiling(text);
    if (!result) return null;

    const existing = await this.prisma.foreclosureFiling.findUnique({
      where: { documentId },
      select: { id: true, verifiedFields: true, fieldConfidence: true },
    });

    const row = applyVerifiedFieldGuard(
      extractionToRow(result.fields),
      existing?.verifiedFields,
    );

    if (existing) {
      const confidence = mergeConfidence(
        existing.fieldConfidence as Record<string, number> | null,
        row.confidence,
      );
      return this.prisma.foreclosureFiling.update({
        where: { documentId },
        data: {
          ...(row.values as any),
          fieldConfidence: confidence,
          extractionVersion: result.extractionVersion,
          ...(opts.leadId ? { leadId: opts.leadId } : {}),
        },
      });
    }

    return this.prisma.foreclosureFiling.create({
      data: {
        documentId,
        leadId: opts.leadId || null,
        organizationId: opts.organizationId || null,
        extractionVersion: result.extractionVersion,
        verifiedFields: [],
        fieldConfidence: row.confidence,
        ...(row.values as any),
      },
    });
  }

  /**
   * Apply a user's hand corrections. Every field named in the patch joins
   * verifiedFields, which permanently exempts it from re-extraction. Unknown
   * column names are rejected rather than silently written.
   */
  async applyUserEdits(
    filingId: string,
    patch: Record<string, unknown>,
    organizationId?: string | null,
  ) {
    const filing = await this.prisma.foreclosureFiling.findFirst({
      where: { id: filingId, ...(organizationId ? { organizationId } : {}) },
      select: { id: true, verifiedFields: true },
    });
    if (!filing) return null;

    const edited = Object.keys(patch).filter(isFilingColumn);
    if (!edited.length) return null;

    const data: any = {};
    for (const column of edited) {
      const value = patch[column];
      if (column === 'hearingAt' || column === 'saleAt' || column === 'filedAt' ||
          column === 'submittedAt' || column === 'dotDate') {
        // Accept an ISO instant from the client; a blank clears the field.
        data[column] = value ? new Date(String(value)) : null;
      } else if (column === 'recordOwnerNames') {
        data[column] = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
      } else if (column === 'originalPrincipal') {
        const n = Number(value);
        data[column] = Number.isFinite(n) ? n : null;
      } else {
        data[column] = value === '' || value === undefined ? null : String(value);
      }
    }

    const verifiedFields = Array.from(new Set([...(filing.verifiedFields || []), ...edited]));
    this.logger.log(`Filing ${filingId}: user verified ${edited.join(', ')}`);

    return this.prisma.foreclosureFiling.update({
      where: { id: filingId },
      data: { ...data, verifiedFields, verifiedByUserAt: new Date() },
    });
  }

  /** The filing for a lead's most recent document, with its confidence map. */
  async forLead(leadId: string, organizationId?: string | null) {
    return this.prisma.foreclosureFiling.findFirst({
      where: { leadId, ...(organizationId ? { organizationId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }
}
