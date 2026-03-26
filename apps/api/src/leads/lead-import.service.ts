import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { formatPhoneNumber } from '@fast-homes/shared';
import { enrichAddressFromZip, cleanStreetAddress } from '../webhooks/address-parser';
import * as XLSX from 'xlsx';

// ── IF3 default mapping preset ───────────────────────────────────────────────
const IF3_MAPPING: Record<string, string> = {
  'Street Address': 'propertyAddress',
  'City': 'propertyCity',
  'State': 'propertyState',
  'Zip Code': 'propertyZip',
  'Seller First Name': 'sellerFirstName',
  'Seller Last Name': 'sellerLastName',
  'Seller Phone': 'sellerPhone',
  'Seller Email': 'sellerEmail',
  'Property Type': 'propertyType',
  'Bedrooms': 'bedrooms',
  'Bathrooms': 'bathrooms',
  'Size (SQFT)': 'sqft',
  'Lot Size': 'lotSize',
  'Year Built': 'yearBuilt',
  'Asking Price': 'askingPrice',
  'Motivation': 'sellerMotivation',
  'Time To Sell': 'timeline',
  'Subdivision': 'subdivision',
  'Latitude': 'latitude',
  'Longitude': 'longitude',
  'Pipeline': 'status',
  'Notes': 'notes',
  'Touches': 'touchCount',
  'Date Created': 'createdAt',
};

// All fields available for mapping
export const IMPORTABLE_FIELDS: { key: string; label: string; required: boolean; type: string }[] = [
  { key: 'propertyAddress', label: 'Property Address', required: true, type: 'string' },
  { key: 'propertyCity', label: 'City', required: false, type: 'string' },
  { key: 'propertyState', label: 'State', required: false, type: 'string' },
  { key: 'propertyZip', label: 'Zip Code', required: false, type: 'string' },
  { key: 'sellerFirstName', label: 'Seller First Name', required: true, type: 'string' },
  { key: 'sellerLastName', label: 'Seller Last Name', required: true, type: 'string' },
  { key: 'sellerPhone', label: 'Seller Phone', required: true, type: 'string' },
  { key: 'sellerEmail', label: 'Seller Email', required: false, type: 'string' },
  { key: 'propertyType', label: 'Property Type', required: false, type: 'string' },
  { key: 'bedrooms', label: 'Bedrooms', required: false, type: 'number' },
  { key: 'bathrooms', label: 'Bathrooms', required: false, type: 'number' },
  { key: 'sqft', label: 'Sqft', required: false, type: 'number' },
  { key: 'lotSize', label: 'Lot Size', required: false, type: 'number' },
  { key: 'yearBuilt', label: 'Year Built', required: false, type: 'number' },
  { key: 'askingPrice', label: 'Asking Price', required: false, type: 'number' },
  { key: 'sellerMotivation', label: 'Seller Motivation', required: false, type: 'string' },
  { key: 'timeline', label: 'Timeline (days)', required: false, type: 'number' },
  { key: 'conditionLevel', label: 'Condition Level', required: false, type: 'string' },
  { key: 'ownershipStatus', label: 'Ownership Status', required: false, type: 'string' },
  { key: 'subdivision', label: 'Subdivision', required: false, type: 'string' },
  { key: 'latitude', label: 'Latitude', required: false, type: 'number' },
  { key: 'longitude', label: 'Longitude', required: false, type: 'number' },
  { key: 'status', label: 'Status', required: false, type: 'string' },
  { key: 'notes', label: 'Notes (creates a note)', required: false, type: 'string' },
  { key: 'touchCount', label: 'Touch Count', required: false, type: 'number' },
  { key: 'createdAt', label: 'Date Created', required: false, type: 'date' },
];

// Map IF3 pipeline values → our status enum
const PIPELINE_STATUS_MAP: Record<string, string> = {
  'new': 'NEW',
  'qualification': 'QUALIFYING',
  'qualified': 'QUALIFIED',
  'offer': 'OFFER_SENT',
  'negotiating': 'NEGOTIATING',
  'under_contract': 'UNDER_CONTRACT',
  'closing': 'CLOSING',
  'closed_won': 'CLOSED_WON',
  'closed_lost': 'CLOSED_LOST',
  'nurture': 'NURTURE',
  'dead': 'DEAD',
};

@Injectable()
export class LeadImportService {
  private readonly logger = new Logger(LeadImportService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Parse an uploaded CSV/XLSX file and return headers + sample rows
   */
  parseUpload(buffer: Buffer, mimetype: string): {
    headers: string[];
    sampleRows: any[][];
    totalRows: number;
    allRows: any[][];
    detectedMapping: Record<string, string>;
  } {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (jsonData.length < 2) {
      throw new Error('File must contain at least a header row and one data row');
    }

    const headers = (jsonData[0] as any[]).map((h) => String(h).trim());
    const dataRows = jsonData.slice(1).filter((row) =>
      row.some((cell: any) => cell !== '' && cell != null),
    );
    const sampleRows = dataRows.slice(0, 5);

    // Auto-detect mapping: check if headers match IF3 column names
    const detectedMapping: Record<string, string> = {};
    for (const header of headers) {
      if (IF3_MAPPING[header]) {
        detectedMapping[header] = IF3_MAPPING[header];
      }
    }

    return {
      headers,
      sampleRows,
      totalRows: dataRows.length,
      allRows: dataRows,
      detectedMapping,
    };
  }

  /**
   * Execute an import using the provided rows and field mapping
   */
  async executeImport(
    headers: string[],
    rows: any[][],
    mapping: Record<string, string>,
    options: {
      source?: string;
      skipDuplicates?: boolean;
      organizationId?: string;
      userId?: string;
    },
  ): Promise<{
    created: number;
    skipped: number;
    errors: { row: number; reason: string }[];
  }> {
    const source = options.source || 'OTHER';
    const skipDuplicates = options.skipDuplicates !== false;
    let created = 0;
    let skipped = 0;
    const errors: { row: number; reason: string }[] = [];

    // Build reverse mapping: crmField → column index
    const fieldToIndex: Record<string, number> = {};
    for (const [sourceHeader, crmField] of Object.entries(mapping)) {
      if (crmField && crmField !== '_skip') {
        const idx = headers.indexOf(sourceHeader);
        if (idx >= 0) fieldToIndex[crmField] = idx;
      }
    }

    // Check required fields are mapped
    const requiredFields = ['propertyAddress', 'sellerFirstName', 'sellerLastName', 'sellerPhone'];
    const missingRequired = requiredFields.filter((f) => fieldToIndex[f] === undefined);
    if (missingRequired.length > 0) {
      throw new Error(`Required fields not mapped: ${missingRequired.join(', ')}`);
    }

    // Get existing phone numbers for duplicate detection
    let existingPhones = new Set<string>();
    if (skipDuplicates) {
      const existingLeads = await this.prisma.lead.findMany({
        select: { sellerPhone: true },
        ...(options.organizationId ? { where: { organizationId: options.organizationId } } : {}),
      });
      existingPhones = new Set(existingLeads.map((l) => l.sellerPhone));
    }

    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i];
        const getValue = (field: string): any => {
          const idx = fieldToIndex[field];
          if (idx === undefined) return undefined;
          const val = row[idx];
          return val === '' || val == null ? undefined : val;
        };

        // Extract and validate required fields
        const rawPhone = String(getValue('sellerPhone') || '');
        const phone = formatPhoneNumber(rawPhone);
        if (!phone) {
          errors.push({ row: i + 2, reason: `Invalid phone number: "${rawPhone}"` });
          continue;
        }

        // Duplicate check
        if (skipDuplicates && existingPhones.has(phone)) {
          skipped++;
          continue;
        }

        const propertyAddress = String(getValue('propertyAddress') || '');
        if (!propertyAddress) {
          errors.push({ row: i + 2, reason: 'Missing property address' });
          continue;
        }

        const sellerFirstName = String(getValue('sellerFirstName') || '');
        const sellerLastName = String(getValue('sellerLastName') || '');
        if (!sellerFirstName || !sellerLastName) {
          errors.push({ row: i + 2, reason: 'Missing seller name' });
          continue;
        }

        // Enrich address
        const enriched = await enrichAddressFromZip({
          propertyAddress,
          propertyCity: String(getValue('propertyCity') || ''),
          propertyState: String(getValue('propertyState') || ''),
          propertyZip: String(getValue('propertyZip') || ''),
        });

        // Map status from IF3 pipeline values
        let status = 'NEW';
        const rawStatus = getValue('status');
        if (rawStatus) {
          const normalized = String(rawStatus).toLowerCase().replace(/\s+/g, '_');
          status = PIPELINE_STATUS_MAP[normalized] || 'NEW';
        }

        // Parse numbers safely
        const parseNum = (val: any): number | undefined => {
          if (val === undefined || val === null || val === '') return undefined;
          const n = Number(val);
          return isNaN(n) ? undefined : n;
        };

        // Parse date safely
        const parseDate = (val: any): Date | undefined => {
          if (!val) return undefined;
          const d = new Date(val);
          return isNaN(d.getTime()) ? undefined : d;
        };

        const notesText = getValue('notes');

        const leadData: any = {
          source,
          status,
          propertyAddress: cleanStreetAddress(enriched.propertyAddress),
          propertyCity: enriched.propertyCity,
          propertyState: enriched.propertyState,
          propertyZip: enriched.propertyZip,
          sellerFirstName,
          sellerLastName,
          sellerPhone: phone,
          sellerEmail: getValue('sellerEmail') || null,
          propertyType: getValue('propertyType') || null,
          bedrooms: parseNum(getValue('bedrooms')),
          bathrooms: parseNum(getValue('bathrooms')),
          sqft: parseNum(getValue('sqft')),
          lotSize: parseNum(getValue('lotSize')),
          yearBuilt: parseNum(getValue('yearBuilt')),
          askingPrice: parseNum(getValue('askingPrice')),
          sellerMotivation: getValue('sellerMotivation') || null,
          timeline: parseNum(getValue('timeline')),
          conditionLevel: getValue('conditionLevel') || null,
          ownershipStatus: getValue('ownershipStatus') || null,
          subdivision: getValue('subdivision') || null,
          latitude: parseNum(getValue('latitude')),
          longitude: parseNum(getValue('longitude')),
          touchCount: parseNum(getValue('touchCount')) || 0,
          organizationId: options.organizationId || null,
        };

        const createdAtVal = parseDate(getValue('createdAt'));
        if (createdAtVal) leadData.createdAt = createdAtVal;

        const lead = await this.prisma.lead.create({ data: leadData });

        // Create note if mapped
        if (notesText && options.userId) {
          await this.prisma.note.create({
            data: {
              leadId: lead.id,
              userId: options.userId,
              content: String(notesText),
            },
          });
        }

        // Track for duplicate detection within the batch
        existingPhones.add(phone);
        created++;
      } catch (err: any) {
        this.logger.warn(`Import row ${i + 2} failed: ${err.message}`);
        errors.push({ row: i + 2, reason: err.message });
      }
    }

    return { created, skipped, errors };
  }
}
