import { Injectable, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import { PrismaService } from '../prisma/prisma.service';
import {
  sha256Hex,
  classifyDocumentType,
  caseNumberFrom,
  charsPerPageOf,
  isTextLayerThin,
  extractionMethodOf,
} from './foreclosure-document.util';

export interface StoredDocument {
  id: string;
  /** True when this exact file was already uploaded; nothing was written. */
  duplicate: boolean;
  /** Lead this filing is attached to, null until one is created for the case. */
  leadId: string | null;
  /** Full extracted text, handed straight to the extractor so it is parsed once. */
  text: string;
  caseNumber: string | null;
  documentType: string | null;
  pageCount: number | null;
  charsPerPage: number | null;
  /** Set when the file has no usable text layer. The row is still persisted. */
  extractionError: string | null;
}

/**
 * Persists uploaded foreclosure filings. Stores the extracted text and file
 * metadata, never the PDF bytes: sampled filings are 3-4 MB each against ~13 KB
 * of text, and no downstream step reads the bytes. Re-extraction and the signal
 * pass both run off rawText, so a stored document is fully re-processable.
 *
 * A file that yields no readable text is still written, with extractionError
 * set, so it surfaces for manual entry instead of vanishing.
 */
@Injectable()
export class ForeclosureDocumentService {
  private readonly logger = new Logger(ForeclosureDocumentService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Parse and persist an uploaded PDF. Idempotent on (organization, file hash):
   * re-uploading the same bytes returns the existing row untouched, along with
   * its stored text so callers can still act on it.
   */
  async storePdf(
    buffer: Buffer,
    filename: string,
    opts: { organizationId?: string | null; leadId?: string | null; noticeUrl?: string | null },
  ): Promise<StoredDocument> {
    const organizationId = opts.organizationId || null;
    const fileHash = sha256Hex(buffer);

    const existing = await this.prisma.foreclosureDocument.findFirst({
      where: { organizationId, fileHash },
    });
    if (existing) {
      return this.toStored(existing, true);
    }

    let text = '';
    let pageCount: number | null = null;
    let parseError: string | null = null;
    try {
      const parsed = await pdfParse(buffer);
      text = parsed.text || '';
      pageCount = parsed.numpages ?? null;
    } catch (e: any) {
      parseError = `PDF parse failed: ${e.message}`;
      this.logger.error(`${parseError} (${filename})`);
    }

    const thin = isTextLayerThin(text, pageCount);
    const extractionError =
      parseError ||
      (thin
        ? 'No usable text layer (image-only PDF). Enter the case details manually.'
        : null);

    const data = {
      organizationId,
      leadId: opts.leadId || null,
      fileHash,
      originalFilename: filename || null,
      fileSizeBytes: buffer.length,
      noticeUrl: opts.noticeUrl || null,
      caseNumber: caseNumberFrom(text),
      documentType: thin ? null : classifyDocumentType(text),
      pageCount,
      extractionMethod: extractionMethodOf(text, pageCount),
      rawText: text || null,
      charsPerPage: charsPerPageOf(text, pageCount),
      extractedAt: thin || parseError ? null : new Date(),
      extractionError,
    };

    try {
      const created = await this.prisma.foreclosureDocument.create({ data });
      return this.toStored(created, false);
    } catch (e: any) {
      // Concurrent upload of the same file won the unique index. Return theirs.
      if (e?.code === 'P2002') {
        const row = await this.prisma.foreclosureDocument.findFirst({
          where: { organizationId, fileHash },
        });
        if (row) return this.toStored(row, true);
      }
      throw e;
    }
  }

  /**
   * Point a document at the lead its case produced. Called after the lead is
   * created, since a filing can be uploaded before any lead exists.
   */
  async attachToLead(documentId: string, leadId: string): Promise<void> {
    await this.prisma.foreclosureDocument.update({
      where: { id: documentId },
      data: { leadId },
    });
  }

  /**
   * Every filing on this lead's case, newest first. Falls back to matching on
   * case number so filings uploaded before the lead existed still appear.
   */
  async listForLead(leadId: string, organizationId?: string | null) {
    const detail = await this.prisma.foreclosureDetail.findUnique({
      where: { leadId },
      select: { caseNumber: true },
    });

    const where: any = {
      OR: [
        { leadId },
        ...(detail?.caseNumber ? [{ caseNumber: detail.caseNumber }] : []),
      ],
    };
    if (organizationId) where.organizationId = organizationId;

    return this.prisma.foreclosureDocument.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      // rawText is up to ~13 KB per row and the list view never renders it.
      select: {
        id: true,
        leadId: true,
        caseNumber: true,
        county: true,
        documentType: true,
        noticeUrl: true,
        originalFilename: true,
        fileSizeBytes: true,
        pageCount: true,
        charsPerPage: true,
        extractionMethod: true,
        extractionError: true,
        uploadedAt: true,
        extractedAt: true,
      },
    });
  }

  private toStored(row: any, duplicate: boolean): StoredDocument {
    return {
      id: row.id,
      duplicate,
      leadId: row.leadId ?? null,
      text: row.rawText || '',
      caseNumber: row.caseNumber,
      documentType: row.documentType,
      pageCount: row.pageCount,
      charsPerPage: row.charsPerPage,
      extractionError: row.extractionError,
    };
  }
}
