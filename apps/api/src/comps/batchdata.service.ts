import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import {
  BatchDataAddress,
  BatchDataDataset,
  BatchDataProperty,
  BatchDataPropertyLookupRequest,
  BatchDataPropertySearchRequest,
  BatchDataSearchResponse,
} from './batchdata.types';

const DEFAULT_BASE_URL = 'https://api.batchdata.com/api/v1';

/**
 * Cost-saving defaults for comp searching. BatchData bills per record returned,
 * so tighter criteria + smaller `take` directly reduces spend.
 *
 * These match the docs' recommended defaults; callers can override per-request.
 */
const DEFAULT_COMP_OPTIONS = {
  take: 25,
  useDistance: true,
  distanceMiles: 1,
  useBedrooms: true,
  minBedrooms: -1,
  maxBedrooms: 1,
  useArea: true,
  minAreaPercent: -20,
  maxAreaPercent: 20,
  // Year built intentionally NOT filtered — remodeled older homes are valid
  // comps and BatchData would otherwise exclude them. Pass false explicitly
  // because BatchData's server-side default is true.
  useYearBuilt: false,
} as const;

/**
 * Minimal projection — the fields we actually render in the comparison view.
 * Reduces response payload size (does NOT reduce billing — billing is per
 * record at the token's full provisioned dataset rate).
 */
const COMP_CUSTOM_PROJECTION: string[] = [
  'address.hash',
  'address.street',
  'address.city',
  'address.state',
  'address.zip',
  'address.county',
  'address.latitude',
  'address.longitude',
  'building.yearBuilt',
  'building.bedroomCount',
  'building.bathroomCount',
  'building.livingAreaSquareFeet',
  'sale.lastSale.price',
  'sale.lastSale.saleDate',
  'valuation.estimatedValue',
  'legal.subdivisionName',
];

/** Datasets needed for comp validation. Skip-trace, image, permit etc. add cost. */
const DEFAULT_DATASETS: BatchDataDataset[] = ['core', 'valuation'];

@Injectable()
export class BatchDataService {
  private readonly logger = new Logger(BatchDataService.name);
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly environment: 'sandbox' | 'production';

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('BATCHDATA_API_KEY');
    this.baseUrl = (
      this.config.get<string>('BATCHDATA_API_BASE_URL') || DEFAULT_BASE_URL
    ).replace(/\/$/, '');
    const env = this.config.get<string>('BATCHDATA_ENVIRONMENT') || 'sandbox';
    this.environment = env === 'production' ? 'production' : 'sandbox';
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Public status payload for the settings/integrations card.
   * Does not echo the API key.
   */
  getStatus() {
    return {
      enabled: this.isConfigured,
      environment: this.environment,
      isConfigured: this.isConfigured,
      baseUrl: this.baseUrl,
    };
  }

  /**
   * Search for comparable properties around a subject.
   *
   * BatchData's comp algorithm runs server-side: pass the subject as
   * `compAddress`, set the use* flags + delta options, and the API filters
   * to ranked comparables. Returns null on any failure (network, auth,
   * malformed response) — callers should treat null as "BatchData unavailable
   * for this lead" and fall back to REAPI in the UI.
   */
  async searchComps(
    subject: BatchDataAddress,
    overrides?: Partial<BatchDataPropertySearchRequest['options']> & {
      // Convenience: filter to single-family residential by default
      propertyTypeDetail?: string[];
      propertyTypeCategory?: string[];
      // Sale-date floor — comps sold before this date are filtered out by
      // BatchData. ISO date string (YYYY-MM-DD).
      saleDateMinDate?: string;
      saleDateMaxDate?: string;
    },
  ): Promise<BatchDataSearchResponse | null> {
    if (!this.isConfigured) {
      this.logger.warn('BatchData API key not configured — skipping comp search');
      return null;
    }

    const {
      propertyTypeDetail,
      propertyTypeCategory,
      saleDateMinDate,
      saleDateMaxDate,
      ...optionOverrides
    } = overrides ?? {};

    const body: BatchDataPropertySearchRequest = {
      searchCriteria: {
        compAddress: subject,
        ...((propertyTypeCategory || propertyTypeDetail) && {
          general: {
            ...(propertyTypeCategory && {
              propertyTypeCategory: { inList: propertyTypeCategory },
            }),
            ...(propertyTypeDetail && {
              propertyTypeDetail: { inList: propertyTypeDetail },
            }),
          },
        }),
        ...((saleDateMinDate || saleDateMaxDate) && {
          sale: {
            lastSaleDate: {
              ...(saleDateMinDate && { minDate: saleDateMinDate }),
              ...(saleDateMaxDate && { maxDate: saleDateMaxDate }),
            },
          },
        }),
      },
      options: {
        ...DEFAULT_COMP_OPTIONS,
        datasets: DEFAULT_DATASETS,
        projection: 'custom',
        customProjection: COMP_CUSTOM_PROJECTION,
        dateFormat: 'iso-date',
        ...optionOverrides,
      },
    };

    return this.post<BatchDataSearchResponse>('/property/search', body, 'searchComps');
  }

  /**
   * Property Lookup (all attributes) for a single property.
   * Returns the full property record — used for subject-property enrichment
   * (Phase 6, currently deferred).
   */
  async lookupProperty(
    address: BatchDataAddress,
    overrides?: Partial<BatchDataPropertyLookupRequest['options']>,
  ): Promise<BatchDataProperty | null> {
    if (!this.isConfigured) {
      this.logger.warn('BatchData API key not configured — skipping property lookup');
      return null;
    }

    const body: BatchDataPropertyLookupRequest = {
      requests: [{ address }],
      options: {
        datasets: DEFAULT_DATASETS,
        dateFormat: 'iso-date',
        ...overrides,
      },
    };

    const response = await this.post<BatchDataSearchResponse>(
      '/property/lookup/all-attributes',
      body,
      'lookupProperty',
    );
    if (!response) return null;

    // Lookup returns at most one record per request; flatten to the single
    // property. Defensive: BatchData has historically nested arrays under
    // `results.properties` but some endpoints return a top-level `properties`.
    const properties = response.results?.properties ?? response.properties ?? [];
    return properties[0] ?? null;
  }

  // ── Internal HTTP plumbing ────────────────────────────────────────────────

  private async post<T>(path: string, body: unknown, label: string): Promise<T | null> {
    const url = `${this.baseUrl}${path}`;
    const startedAt = Date.now();

    try {
      const response = await axios.post<T>(url, body, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      });

      const latencyMs = Date.now() - startedAt;
      this.logger.log(
        `BatchData ${label} OK (${this.environment}, ${latencyMs}ms, status=${response.status})`,
      );
      return response.data;
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const ax = err as AxiosError<{ message?: string; error?: string }>;
      const status = ax.response?.status ?? 'network';
      const message = ax.response?.data?.message ?? ax.response?.data?.error ?? ax.message;

      if (status === 401 || status === 403) {
        this.logger.error(
          `BatchData ${label} auth error (${status}, ${latencyMs}ms): ${message}. ` +
          `Check BATCHDATA_API_KEY for the ${this.environment} environment.`,
        );
      } else if (status === 429) {
        this.logger.warn(
          `BatchData ${label} rate-limited (${latencyMs}ms): ${message}`,
        );
      } else if (status === 'network') {
        this.logger.warn(
          `BatchData ${label} network error (${latencyMs}ms): ${ax.message}`,
        );
      } else {
        this.logger.warn(
          `BatchData ${label} failed (${status}, ${latencyMs}ms): ${message}`,
        );
      }
      return null;
    }
  }
}
