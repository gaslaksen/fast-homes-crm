import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DealPackage {
  lead: {
    id: string;
    propertyAddress: string;
    propertyCity: string;
    propertyState: string;
    propertyZip: string;
    propertyType: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    sqft: number | null;
    yearBuilt: number | null;
    lotSize: number | null;
    stories: number | null;
    primaryPhoto: string | null;
    photos: any;
    latitude: number | null;
    longitude: number | null;
  };
  analysis: {
    arvEstimate: number | null;
    arvLow: number | null;
    arvHigh: number | null;
    arvMethod: string;
    confidenceTier: string | null;
    confidenceScore: number;
    repairCosts: number | null;
    repairFinishLevel: string | null;
    dealType: string;
    assignmentFee: number;
    maoPercent: number;
    mao: number;
    negotiationRangeLow: number | null;
    negotiationRangeHigh: number | null;
    aiSummary: string | null;
    triangulatedArv: number | null;
    riskAdjustedArv: number | null;
    pricePerSqft: number | null;
    // Rich data
    dealIntelligence: any | null;
    photoAnalysis: any | null;
    aiAssessment: any | null;
    repairItems: any | null;
    repairNotes: string | null;
    conditionTier: string | null;
  } | null;
  comps: Array<{
    address: string;
    soldPrice: number;
    soldDate: string;
    sqft: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    yearBuilt: number | null;
    distance: number;
    photoUrl: string | null;
  }>;
}

function safeParse(val: string | null | undefined): any {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

@Injectable()
export class DealPackageService {
  constructor(private prisma: PrismaService) {}

  async buildDealPackage(leadId: string): Promise<DealPackage> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
        propertyType: true,
        bedrooms: true,
        bathrooms: true,
        sqft: true,
        sqftOverride: true,
        yearBuilt: true,
        lotSize: true,
        stories: true,
        primaryPhoto: true,
        photos: true,
        latitude: true,
        longitude: true,
        arv: true,
        repairCosts: true,
        assignmentFee: true,
        maoPercent: true,
        askingPrice: true,
      },
    });
    if (!lead) throw new NotFoundException('Lead not found');

    // Get latest comp analysis with ALL rich data fields
    const analysis = await this.prisma.compAnalysis.findFirst({
      where: { leadId },
      orderBy: { updatedAt: 'desc' },
    });

    // Get selected comps from latest analysis
    const comps = analysis
      ? await this.prisma.comp.findMany({
          where: { analysisId: analysis.id, selected: true },
          select: {
            address: true,
            soldPrice: true,
            soldDate: true,
            sqft: true,
            bedrooms: true,
            bathrooms: true,
            yearBuilt: true,
            distance: true,
            photoUrl: true,
          },
          orderBy: { distance: 'asc' },
          take: 8,
        })
      : [];

    // Calculate MAO from analysis data
    let mao = 0;
    if (analysis) {
      const arv = analysis.arvEstimate || 0;
      const repairs = analysis.repairCosts || 0;
      const fee = analysis.assignmentFee || 15000;
      const pct = analysis.maoPercent || 70;
      mao = Math.round((arv * pct / 100) - repairs - fee);
    }

    return {
      lead: {
        id: lead.id,
        propertyAddress: lead.propertyAddress,
        propertyCity: lead.propertyCity,
        propertyState: lead.propertyState,
        propertyZip: lead.propertyZip,
        propertyType: lead.propertyType,
        bedrooms: lead.bedrooms,
        bathrooms: lead.bathrooms,
        sqft: lead.sqftOverride || lead.sqft,
        yearBuilt: lead.yearBuilt,
        lotSize: lead.lotSize,
        stories: lead.stories,
        primaryPhoto: lead.primaryPhoto,
        photos: lead.photos,
        latitude: lead.latitude,
        longitude: lead.longitude,
      },
      analysis: analysis
        ? {
            arvEstimate: analysis.arvEstimate,
            arvLow: analysis.arvLow,
            arvHigh: analysis.arvHigh,
            arvMethod: analysis.arvMethod,
            confidenceTier: analysis.confidenceTier,
            confidenceScore: analysis.confidenceScore,
            repairCosts: analysis.repairCosts,
            repairFinishLevel: analysis.repairFinishLevel,
            dealType: analysis.dealType,
            assignmentFee: analysis.assignmentFee,
            maoPercent: analysis.maoPercent,
            mao,
            negotiationRangeLow: analysis.negotiationRangeLow,
            negotiationRangeHigh: analysis.negotiationRangeHigh,
            aiSummary: analysis.aiSummary,
            triangulatedArv: analysis.triangulatedArv,
            riskAdjustedArv: analysis.riskAdjustedArv,
            pricePerSqft: analysis.pricePerSqft,
            dealIntelligence: safeParse(analysis.dealIntelligence),
            photoAnalysis: safeParse(analysis.photoAnalysis),
            aiAssessment: safeParse(analysis.aiAssessment),
            repairItems: analysis.repairItems as any,
            repairNotes: analysis.repairNotes,
            conditionTier: analysis.conditionTier,
          }
        : null,
      comps: comps.map((c) => ({
        address: c.address,
        soldPrice: c.soldPrice,
        soldDate: c.soldDate.toISOString().split('T')[0],
        sqft: c.sqft,
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        yearBuilt: c.yearBuilt,
        distance: c.distance,
        photoUrl: c.photoUrl,
      })),
    };
  }

  // ── Partner-type-specific email rendering ─────────────────────────────────

  renderEmailHtml(
    pkg: DealPackage,
    options: { personalNote?: string; viewUrl: string; senderName?: string; orgName?: string },
    partnerType: string = 'buyer',
  ): string {
    const { lead, analysis, comps } = pkg;
    const { personalNote, viewUrl, senderName, orgName } = options;

    const fmt = (n: number | null | undefined) =>
      n != null ? `$${Math.round(n).toLocaleString('en-US')}` : 'N/A';
    const fmtNum = (n: number | null | undefined) =>
      n != null ? n.toLocaleString('en-US') : 'N/A';

    const di = analysis?.dealIntelligence;
    const pa = analysis?.photoAnalysis;

    // ── Partner-type framing ────────────────────────────────────────────────
    const framing = this.getPartnerFraming(partnerType, analysis, di, pa);

    const photoUrl = lead.primaryPhoto || '';
    const photoSection = photoUrl
      ? `<tr><td style="padding:0"><img src="${photoUrl}" alt="Property" style="width:100%;max-height:300px;object-fit:cover;border-radius:8px 8px 0 0;" /></td></tr>`
      : '';

    // ── Comp rows with bed/bath ─────────────────────────────────────────────
    const compRows = comps.slice(0, 5).map((c) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;">${c.address}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;text-align:right;">${fmt(c.soldPrice)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;text-align:center;">${c.bedrooms ?? '-'}/${c.bathrooms ?? '-'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;text-align:right;">${fmtNum(c.sqft)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;text-align:right;">${c.distance.toFixed(1)} mi</td>
      </tr>`).join('');

    const personalNoteSection = personalNote
      ? `<tr><td style="padding:24px 32px 0 32px;">
          <div style="background:#f0f9ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:0 8px 8px 0;">
            <p style="margin:0 0 4px 0;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">Note from ${senderName || 'the team'}</p>
            <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.5;">${personalNote}</p>
          </div>
        </td></tr>`
      : '';

    // ── "Why This Deal" section ─────────────────────────────────────────────
    const bottomLine = di?.bottomLine;
    const whyThisDeal = bottomLine
      ? `<tr><td style="padding:24px 32px 0 32px;">
          <div style="background:#fefce8;border-left:4px solid #ca8a04;padding:16px 20px;border-radius:0 8px 8px 0;">
            <p style="margin:0 0 4px 0;font-size:12px;color:#92400e;font-weight:700;text-transform:uppercase;">Why This Deal</p>
            <p style="margin:0;font-size:14px;color:#1c1917;line-height:1.6;">${bottomLine}</p>
          </div>
        </td></tr>`
      : '';

    // ── Market & condition badges ───────────────────────────────────────────
    const velocity = di?.marketVelocity?.verdict;
    const avgPpsf = di?.ppsfAnalysis?.avgPpsf || analysis?.pricePerSqft;
    const condition = pa?.overallCondition || analysis?.conditionTier;

    const velocityColors: Record<string, string> = { hot: '#059669', normal: '#2563eb', slow: '#dc2626' };
    const conditionColors: Record<string, string> = { Good: '#059669', Fair: '#ca8a04', Poor: '#dc2626', Gut: '#7c2d12' };

    let badgesHtml = '';
    const badges: string[] = [];
    if (velocity && velocity !== 'unknown') {
      badges.push(`<span style="display:inline-block;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;color:#fff;background:${velocityColors[velocity] || '#6b7280'};text-transform:uppercase;">${velocity} Market</span>`);
    }
    if (condition) {
      badges.push(`<span style="display:inline-block;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:700;color:#fff;background:${conditionColors[condition] || '#6b7280'};text-transform:uppercase;">${condition} Condition</span>`);
    }
    if (avgPpsf) {
      badges.push(`<span style="display:inline-block;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#374151;background:#f3f4f6;">$${Math.round(avgPpsf)}/sqft</span>`);
    }
    if (badges.length > 0) {
      badgesHtml = `<tr><td style="padding:16px 32px 0 32px;">${badges.join(' &nbsp;')}</td></tr>`;
    }

    // ── Exit scenarios (for JV and fix_and_flip) ────────────────────────────
    let exitScenariosHtml = '';
    if ((partnerType === 'jv_partner' || partnerType === 'fix_and_flip') && di?.exitScenarios?.length) {
      const scenarios = di.exitScenarios.slice(0, 3);
      const scenarioCells = scenarios.map((s: any) => `
        <td style="padding:12px;width:${Math.floor(100/scenarios.length)}%;vertical-align:top;border-right:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;">${s.name}</p>
          <p style="margin:4px 0 0 0;font-size:18px;color:#059669;font-weight:700;">${fmt(s.estimatedSalePrice)}</p>
          ${s.estimatedRepairCost ? `<p style="margin:2px 0 0 0;font-size:12px;color:#6b7280;">Repairs: ${fmt(s.estimatedRepairCost)}</p>` : ''}
          <p style="margin:2px 0 0 0;font-size:12px;color:#6b7280;">${s.timeToSell || ''}</p>
        </td>`).join('');
      exitScenariosHtml = `<tr><td style="padding:20px 32px 0 32px;">
        <p style="margin:0 0 8px 0;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;">Exit Scenarios</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;border-radius:8px;overflow:hidden;">
          <tr>${scenarioCells}</tr>
        </table>
      </td></tr>`;
    }

    // ── Risk factors (for hedge_fund) ───────────────────────────────────────
    let riskHtml = '';
    if (partnerType === 'hedge_fund' && di?.riskFactors?.length) {
      const impactColors: Record<string, string> = { high: '#dc2626', medium: '#ca8a04', low: '#059669' };
      const riskItems = di.riskFactors.slice(0, 3).map((r: any) => `
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#374151;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${impactColors[r.impact] || '#6b7280'};margin-right:8px;"></span>
            <strong>${r.factor}</strong> — ${r.detail}
          </td>
        </tr>`).join('');
      riskHtml = `<tr><td style="padding:20px 32px 0 32px;">
        <p style="margin:0 0 8px 0;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;">Risk Assessment</p>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${riskItems}</table>
      </td></tr>`;
    }

    // ── AI market analysis ──────────────────────────────────────────────────
    const marketSummary = analysis?.aiSummary;
    const marketHtml = marketSummary
      ? `<tr><td style="padding:20px 32px 0 32px;">
          <p style="margin:0 0 8px 0;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;">Market Analysis</p>
          <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${marketSummary}</p>
        </td></tr>`
      : '';

    return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

  <!-- Header -->
  <tr><td style="background:#111827;padding:20px 32px;">
    <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;">${orgName || 'Deal Core'}</p>
    <p style="margin:4px 0 0 0;font-size:13px;color:${framing.accentColor};">${framing.headline}</p>
  </td></tr>

  <!-- Photo -->
  ${photoSection}

  <!-- Property Address -->
  <tr><td style="padding:24px 32px 0 32px;">
    <h1 style="margin:0;font-size:22px;color:#111827;font-weight:700;">${lead.propertyAddress}</h1>
    <p style="margin:4px 0 0 0;font-size:15px;color:#6b7280;">${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}</p>
  </td></tr>

  <!-- Badges -->
  ${badgesHtml}

  <!-- Property Details Grid -->
  <tr><td style="padding:20px 32px 0 32px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
        <td style="padding:8px 0;width:33%;">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;">Beds / Baths</p>
          <p style="margin:2px 0 0 0;font-size:16px;color:#111827;font-weight:600;">${lead.bedrooms ?? '-'} / ${lead.bathrooms ?? '-'}</p>
        </td>
        <td style="padding:8px 0;width:33%;">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;">Sqft</p>
          <p style="margin:2px 0 0 0;font-size:16px;color:#111827;font-weight:600;">${fmtNum(lead.sqft)}</p>
        </td>
        <td style="padding:8px 0;width:34%;">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;">Year Built</p>
          <p style="margin:2px 0 0 0;font-size:16px;color:#111827;font-weight:600;">${lead.yearBuilt ?? '-'}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;">Lot Size</p>
          <p style="margin:2px 0 0 0;font-size:16px;color:#111827;font-weight:600;">${lead.lotSize ? (lead.lotSize >= 1 ? lead.lotSize.toFixed(2) + ' acres' : Math.round(lead.lotSize * 43560).toLocaleString() + ' sqft') : '-'}</p>
        </td>
        <td style="padding:8px 0;">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;">Type</p>
          <p style="margin:2px 0 0 0;font-size:16px;color:#111827;font-weight:600;">${lead.propertyType || '-'}</p>
        </td>
        <td style="padding:8px 0;">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase;">Stories</p>
          <p style="margin:2px 0 0 0;font-size:16px;color:#111827;font-weight:600;">${lead.stories ?? '-'}</p>
        </td>
      </tr>
    </table>
  </td></tr>

  ${analysis ? `
  <!-- Deal Numbers (partner-type-specific) -->
  <tr><td style="padding:24px 32px 0 32px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;border-radius:8px;overflow:hidden;">
      <tr>
        ${framing.numberCells.map((cell: any, i: number) => `
        <td style="padding:16px;text-align:center;width:${Math.floor(100/framing.numberCells.length)}%;${i < framing.numberCells.length - 1 ? 'border-right:1px solid #e2e8f0;' : ''}">
          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">${cell.label}</p>
          <p style="margin:4px 0 0 0;font-size:22px;color:${cell.color};font-weight:700;">${cell.value}</p>
          ${cell.sub ? `<p style="margin:2px 0 0 0;font-size:11px;color:#94a3b8;">${cell.sub}</p>` : ''}
        </td>`).join('')}
      </tr>
    </table>
    ${framing.metaLine ? `<p style="margin:8px 0 0 0;font-size:13px;color:#6b7280;">${framing.metaLine}</p>` : ''}
  </td></tr>
  ` : ''}

  <!-- Why This Deal -->
  ${whyThisDeal}

  ${personalNoteSection}

  <!-- Exit Scenarios -->
  ${exitScenariosHtml}

  <!-- Risk Assessment -->
  ${riskHtml}

  <!-- Market Analysis -->
  ${marketHtml}

  ${comps.length > 0 ? `
  <!-- Comparable Sales -->
  <tr><td style="padding:24px 32px 0 32px;">
    <p style="margin:0 0 12px 0;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;">Comparable Sales</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:600;">Address</th>
        <th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:right;font-weight:600;">Price</th>
        <th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:center;font-weight:600;">Bd/Ba</th>
        <th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:right;font-weight:600;">Sqft</th>
        <th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:right;font-weight:600;">Dist</th>
      </tr>
      ${compRows}
    </table>
  </td></tr>` : ''}

  <!-- CTA -->
  <tr><td style="padding:32px;text-align:center;">
    <a href="${viewUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:8px;">
      View Full Analysis
    </a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 32px;border-top:1px solid #e5e7eb;">
    <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">${orgName || 'Deal Core'} &mdash; Real estate deal intelligence</p>
    <p style="margin:4px 0 0 0;font-size:11px;color:#d1d5db;text-align:center;">This deal package was shared privately. Please do not forward without permission.</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
  }

  // ── Partner-type framing logic ────────────────────────────────────────────

  private getPartnerFraming(partnerType: string, analysis: any, di: any, pa: any) {
    const fmt = (n: number | null | undefined) =>
      n != null ? `$${Math.round(n).toLocaleString('en-US')}` : 'N/A';

    const arv = analysis?.arvEstimate;
    const repairs = analysis?.repairCosts;
    const mao = analysis?.mao;
    const fee = analysis?.assignmentFee;
    const confidence = analysis?.confidenceTier;
    const ppsf = di?.ppsfAnalysis?.avgPpsf || analysis?.pricePerSqft;

    // Calculate projected profit for JV/flip types
    const netProceeds = arv ? Math.round(arv * 0.92) : null; // After 6% commission + 2% closing
    const projectedProfit = netProceeds && repairs && mao ? Math.round(netProceeds - mao - repairs) : null;

    // Exit scenario data
    const bestExit = di?.exitScenarios?.find((s: any) => s.name === 'Full ARV');
    const flipTimeline = bestExit?.timeToSell || '4-6 months';

    switch (partnerType) {
      case 'jv_partner':
        return {
          headline: 'Joint Venture Opportunity',
          accentColor: '#a78bfa', // purple
          numberCells: [
            { label: 'ARV', value: fmt(arv), color: '#059669', sub: analysis?.arvLow && analysis?.arvHigh ? `${fmt(analysis.arvLow)} - ${fmt(analysis.arvHigh)}` : '' },
            { label: 'Est. Repairs', value: fmt(repairs), color: '#dc2626', sub: analysis?.repairFinishLevel?.replace(/_/g, ' ') || '' },
            { label: 'Projected Profit', value: fmt(projectedProfit), color: '#7c3aed', sub: flipTimeline },
          ],
          metaLine: `ARV @ ${analysis?.maoPercent || 70}% &mdash; Built for equity partnership`,
        };

      case 'hedge_fund':
        return {
          headline: 'Investment Opportunity',
          accentColor: '#60a5fa', // blue
          numberCells: [
            { label: 'ARV', value: fmt(arv), color: '#059669', sub: analysis?.arvLow && analysis?.arvHigh ? `${fmt(analysis.arvLow)} - ${fmt(analysis.arvHigh)}` : '' },
            { label: '$/Sqft', value: ppsf ? `$${Math.round(ppsf)}` : 'N/A', color: '#2563eb', sub: 'Comp average' },
            { label: 'Confidence', value: confidence || 'N/A', color: confidence === 'High' ? '#059669' : confidence === 'Medium' ? '#ca8a04' : '#dc2626', sub: `Score: ${analysis?.confidenceScore || 0}/100` },
          ],
          metaLine: `Est. Repairs: ${fmt(repairs)} &mdash; Risk-adjusted data available in full analysis`,
        };

      case 'fix_and_flip':
        return {
          headline: 'Flip Opportunity',
          accentColor: '#f97316', // orange
          numberCells: [
            { label: 'ARV', value: fmt(arv), color: '#059669', sub: '' },
            { label: 'Rehab Cost', value: fmt(repairs), color: '#dc2626', sub: analysis?.repairFinishLevel?.replace(/_/g, ' ') || '' },
            { label: 'Net Profit', value: fmt(projectedProfit), color: projectedProfit && projectedProfit > 0 ? '#059669' : '#dc2626', sub: `Buy @ ${fmt(mao)}` },
          ],
          metaLine: flipTimeline ? `Estimated timeline: ${flipTimeline}` : '',
        };

      case 'buyer':
      default:
        return {
          headline: 'Wholesale Opportunity',
          accentColor: '#34d399', // green
          numberCells: [
            { label: 'ARV', value: fmt(arv), color: '#059669', sub: '' },
            { label: 'Est. Repairs', value: fmt(repairs), color: '#dc2626', sub: '' },
            { label: 'MAO', value: fmt(mao), color: '#2563eb', sub: `@ ${analysis?.maoPercent || 70}%` },
          ],
          metaLine: `Assignment Fee: ${fmt(fee)} &mdash; Sale Price to Buyer: ${fmt(mao && fee ? mao + fee : null)}`,
        };
    }
  }
}
