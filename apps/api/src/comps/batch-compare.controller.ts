import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { CompsService } from './comps.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One-off batch comparison endpoint for the BatchData validation phase.
 *
 * Takes a list of lead IDs, runs both REAPI and BatchData against each
 * (force refresh), and returns a CSV with two sections: a per-lead summary
 * (counts, avg ARVs, divergence %) and per-comp detail rows.
 *
 * Cost: each lead costs ~25 billable BatchData records. 10 leads ≈ 250
 * records. Run sparingly.
 */
@Controller('admin/batch-compare-providers')
export class BatchCompareController {
  private readonly logger = new Logger(BatchCompareController.name);

  constructor(
    private compsService: CompsService,
    private prisma: PrismaService,
  ) {}

  @Post()
  async batchCompare(
    @Body()
    body: {
      leadIds?: string[];
      autoSelect?: { count?: number; mode?: 'diverse-states' | 'random' };
      appUrl?: string;
    },
    @Res() res: Response,
  ) {
    let leadIds = (body.leadIds || []).filter(Boolean);

    // autoSelect mode — endpoint picks leads itself so the caller doesn't
    // have to wrangle SQL.
    if (leadIds.length === 0 && body.autoSelect) {
      const count = Math.max(1, Math.min(50, body.autoSelect.count ?? 10));
      const mode = body.autoSelect.mode ?? 'diverse-states';

      if (mode === 'diverse-states') {
        // One lead per state, up to `count`, randomized within each state.
        const picked = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT DISTINCT ON ("propertyState") id
           FROM leads
           WHERE "propertyAddress" IS NOT NULL
             AND "propertyCity" IS NOT NULL
             AND "propertyState" IS NOT NULL
             AND "propertyZip" IS NOT NULL
             AND status::text != 'DEAD'
           ORDER BY "propertyState", random()
           LIMIT $1`,
          count,
        );
        leadIds = picked.map((r) => r.id);
      } else {
        const picked = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM leads
           WHERE "propertyAddress" IS NOT NULL
             AND "propertyCity" IS NOT NULL
             AND "propertyState" IS NOT NULL
             AND "propertyZip" IS NOT NULL
             AND status::text != 'DEAD'
           ORDER BY random()
           LIMIT $1`,
          count,
        );
        leadIds = picked.map((r) => r.id);
      }

      this.logger.log(`autoSelect picked ${leadIds.length} leads (mode=${mode})`);
    }

    if (leadIds.length === 0) {
      res.status(400).json({
        error:
          'Provide either { leadIds: [...] } or { autoSelect: { count: N, mode: "diverse-states" | "random" } } in the request body.',
      });
      return;
    }
    if (leadIds.length > 50) {
      res.status(400).json({ error: 'Capped at 50 leads per batch (cost guardrail).' });
      return;
    }

    const appUrl = (body.appUrl || 'https://app.mydealcore.com').replace(/\/$/, '');
    const results: Array<
      | { leadId: string; error: string }
      | { lead: any; comps: any[] }
    > = [];

    this.logger.log(`Batch comparison kicked off for ${leadIds.length} leads`);

    for (const leadId of leadIds) {
      try {
        const lead = await this.prisma.lead.findUnique({
          where: { id: leadId },
          select: {
            id: true,
            sellerFirstName: true,
            sellerLastName: true,
            propertyAddress: true,
            propertyCity: true,
            propertyState: true,
            propertyZip: true,
            bedrooms: true,
            bathrooms: true,
            sqft: true,
            status: true,
            doNotContact: true,
          },
        });
        if (!lead) {
          results.push({ leadId, error: 'Lead not found' });
          continue;
        }
        if (!lead.propertyAddress || !lead.propertyCity || !lead.propertyState || !lead.propertyZip) {
          results.push({ leadId, error: 'Lead missing address fields' });
          continue;
        }

        const address = {
          street: lead.propertyAddress,
          city: lead.propertyCity,
          state: lead.propertyState,
          zip: lead.propertyZip,
        };

        // Run providers in parallel for this lead. Each persists to its own
        // source bucket so the deletes don't conflict.
        await Promise.all([
          this.compsService
            .fetchComps(leadId, address, { forceRefresh: true, preferSource: 'reapi' })
            .catch((err) => this.logger.warn(`REAPI fetch failed for ${leadId}: ${(err as Error).message}`)),
          this.compsService
            .fetchComps(leadId, address, { forceRefresh: true, preferSource: 'batchdata' })
            .catch((err) => this.logger.warn(`BatchData fetch failed for ${leadId}: ${(err as Error).message}`)),
        ]);

        // Latest lead-level comps (analysis snapshots excluded)
        const comps = await this.prisma.comp.findMany({
          where: { leadId, analysisId: null, source: { in: ['reapi', 'batchdata'] } },
          orderBy: [{ source: 'asc' }, { soldPrice: 'desc' }],
        });

        results.push({ lead, comps });
        this.logger.log(`Batch comparison ${leadId}: ${comps.length} comps total`);
      } catch (err) {
        results.push({ leadId, error: (err as Error).message });
        this.logger.warn(`Batch comparison failed for ${leadId}: ${(err as Error).message}`);
      }
    }

    const csv = buildCsv(results, appUrl);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="provider-comparison-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }
}

// ─── CSV builder ───────────────────────────────────────────────────────────

function escape(v: any): string {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

function row(cells: any[]): string {
  return cells.map(escape).join(',');
}

function avg(arr: number[]): number {
  return arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : 0;
}

function buildCsv(
  results: Array<{ leadId: string; error: string } | { lead: any; comps: any[] }>,
  appUrl: string,
): string {
  const lines: string[] = [];

  // ── Summary section ──
  lines.push('# SUMMARY (one row per lead)');
  lines.push(
    row([
      'lead_id',
      'lead_url',
      'status',
      'seller_name',
      'subject_address',
      'state',
      'subject_beds',
      'subject_baths',
      'subject_sqft',
      'reapi_count',
      'reapi_avg_arv',
      'batchdata_count',
      'batchdata_avg_arv',
      'divergence_pct',
      'error',
    ]),
  );

  for (const r of results) {
    if ('error' in r) {
      lines.push(row([r.leadId, `${appUrl}/leads/${r.leadId}`, '', '', '', '', '', '', '', '', '', '', '', '', r.error]));
      continue;
    }
    const lead = r.lead;
    const reapiComps = r.comps.filter((c: any) => c.source === 'reapi');
    const batchComps = r.comps.filter((c: any) => c.source === 'batchdata');
    const reapiArv = avg(reapiComps.map((c: any) => c.soldPrice).filter(Boolean));
    const batchArv = avg(batchComps.map((c: any) => c.soldPrice).filter(Boolean));
    const divergence =
      reapiArv > 0 && batchArv > 0
        ? Math.round((Math.abs(reapiArv - batchArv) / reapiArv) * 100)
        : '';
    const sellerName = [lead.sellerFirstName, lead.sellerLastName].filter(Boolean).join(' ') || '—';
    const subjectAddr = `${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip || ''}`.trim();

    lines.push(
      row([
        lead.id,
        `${appUrl}/leads/${lead.id}`,
        lead.status,
        sellerName,
        subjectAddr,
        lead.propertyState,
        lead.bedrooms,
        lead.bathrooms,
        lead.sqft,
        reapiComps.length,
        reapiArv,
        batchComps.length,
        batchArv,
        divergence,
        '',
      ]),
    );
  }

  // ── Detail section ──
  lines.push('');
  lines.push('# COMP DETAILS (one row per comp, source-tagged)');
  lines.push(
    row([
      'lead_id',
      'lead_url',
      'subject_address',
      'state',
      'provider',
      'comp_address',
      'comp_price',
      'comp_sale_date',
      'comp_sqft',
      'comp_price_per_sqft',
      'comp_beds',
      'comp_baths',
      'comp_distance_mi',
      'comp_months_ago',
      'comp_correlation_pct',
      'comp_year_built',
    ]),
  );

  for (const r of results) {
    if ('error' in r) continue;
    const lead = r.lead;
    const subjectAddr = `${lead.propertyAddress}, ${lead.propertyCity}, ${lead.propertyState}`;
    for (const c of r.comps) {
      const monthsAgo = c.soldDate
        ? Math.round((Date.now() - new Date(c.soldDate).getTime()) / (30 * 24 * 60 * 60 * 1000))
        : '';
      const ppsf = c.sqft && c.soldPrice ? Math.round(c.soldPrice / c.sqft) : '';
      const corr = c.correlation != null ? Math.round(c.correlation * 100) : '';
      const saleDate = c.soldDate ? new Date(c.soldDate).toISOString().slice(0, 10) : '';
      lines.push(
        row([
          lead.id,
          `${appUrl}/leads/${lead.id}`,
          subjectAddr,
          lead.propertyState,
          c.source,
          c.address,
          c.soldPrice,
          saleDate,
          c.sqft,
          ppsf,
          c.bedrooms,
          c.bathrooms,
          c.distance,
          monthsAgo,
          corr,
          c.yearBuilt,
        ]),
      );
    }
  }

  return lines.join('\n');
}
