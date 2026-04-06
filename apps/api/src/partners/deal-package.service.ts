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
    repairCosts: number | null;
    repairFinishLevel: string | null;
    dealType: string;
    assignmentFee: number;
    maoPercent: number;
    mao: number;
    negotiationRangeLow: number | null;
    negotiationRangeHigh: number | null;
    aiSummary: string | null;
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

    // Get latest comp analysis
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
          take: 5,
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
            repairCosts: analysis.repairCosts,
            repairFinishLevel: analysis.repairFinishLevel,
            dealType: analysis.dealType,
            assignmentFee: analysis.assignmentFee,
            maoPercent: analysis.maoPercent,
            mao,
            negotiationRangeLow: analysis.negotiationRangeLow,
            negotiationRangeHigh: analysis.negotiationRangeHigh,
            aiSummary: analysis.aiSummary,
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

  renderEmailHtml(
    pkg: DealPackage,
    options: { personalNote?: string; viewUrl: string; senderName?: string; orgName?: string },
  ): string {
    const { lead, analysis, comps } = pkg;
    const { personalNote, viewUrl, senderName, orgName } = options;

    const fmt = (n: number | null | undefined) =>
      n != null ? `$${Math.round(n).toLocaleString('en-US')}` : 'N/A';
    const fmtNum = (n: number | null | undefined) =>
      n != null ? n.toLocaleString('en-US') : 'N/A';

    const photoUrl = lead.primaryPhoto || '';
    const photoSection = photoUrl
      ? `<tr><td style="padding:0"><img src="${photoUrl}" alt="Property" style="width:100%;max-height:300px;object-fit:cover;border-radius:8px 8px 0 0;" /></td></tr>`
      : '';

    const dealTypeLabel: Record<string, string> = {
      wholesale: 'Wholesale',
      novation: 'Novation',
      retail: 'Retail Flip',
      'subject-to': 'Subject-To',
      'joint venture': 'Joint Venture',
    };

    const compRows = comps
      .map(
        (c) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;">${c.address}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;text-align:right;">${fmt(c.soldPrice)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;text-align:right;">${c.soldDate}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;text-align:right;">${fmtNum(c.sqft)} sqft</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151;text-align:right;">${c.distance.toFixed(1)} mi</td>
      </tr>`,
      )
      .join('');

    const personalNoteSection = personalNote
      ? `<tr><td style="padding:24px 32px 0 32px;">
          <div style="background:#f0f9ff;border-left:4px solid #2563eb;padding:16px 20px;border-radius:0 8px 8px 0;">
            <p style="margin:0 0 4px 0;font-size:12px;color:#6b7280;font-weight:600;text-transform:uppercase;">Note from ${senderName || 'the team'}</p>
            <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.5;">${personalNote}</p>
          </div>
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
    <p style="margin:4px 0 0 0;font-size:13px;color:#9ca3af;">Investment Opportunity</p>
  </td></tr>

  <!-- Photo -->
  ${photoSection}

  <!-- Property Address -->
  <tr><td style="padding:24px 32px 0 32px;">
    <h1 style="margin:0;font-size:22px;color:#111827;font-weight:700;">${lead.propertyAddress}</h1>
    <p style="margin:4px 0 0 0;font-size:15px;color:#6b7280;">${lead.propertyCity}, ${lead.propertyState} ${lead.propertyZip}</p>
  </td></tr>

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
  <!-- Deal Numbers -->
  <tr><td style="padding:24px 32px 0 32px;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f8fafc;border-radius:8px;overflow:hidden;">
      <tr>
        <td style="padding:16px;text-align:center;width:33%;border-right:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">ARV</p>
          <p style="margin:4px 0 0 0;font-size:22px;color:#059669;font-weight:700;">${fmt(analysis.arvEstimate)}</p>
        </td>
        <td style="padding:16px;text-align:center;width:33%;border-right:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">Est. Repairs</p>
          <p style="margin:4px 0 0 0;font-size:22px;color:#dc2626;font-weight:700;">${fmt(analysis.repairCosts)}</p>
        </td>
        <td style="padding:16px;text-align:center;width:34%;">
          <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;">MAO</p>
          <p style="margin:4px 0 0 0;font-size:22px;color:#2563eb;font-weight:700;">${fmt(analysis.mao)}</p>
        </td>
      </tr>
    </table>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:12px;">
      <tr>
        <td style="font-size:13px;color:#6b7280;">Deal Type: <strong style="color:#111827;">${dealTypeLabel[analysis.dealType] || analysis.dealType}</strong></td>
        <td style="font-size:13px;color:#6b7280;text-align:right;">Assignment Fee: <strong style="color:#111827;">${fmt(analysis.assignmentFee)}</strong></td>
      </tr>
    </table>
  </td></tr>

  ${analysis.aiSummary ? `
  <!-- AI Summary -->
  <tr><td style="padding:20px 32px 0 32px;">
    <p style="margin:0 0 8px 0;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;">Market Analysis</p>
    <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${analysis.aiSummary.length > 500 ? analysis.aiSummary.substring(0, 500) + '...' : analysis.aiSummary}</p>
  </td></tr>` : ''}
  ` : ''}

  ${personalNoteSection}

  ${comps.length > 0 ? `
  <!-- Comparable Sales -->
  <tr><td style="padding:24px 32px 0 32px;">
    <p style="margin:0 0 12px 0;font-size:13px;color:#6b7280;font-weight:600;text-transform:uppercase;">Comparable Sales</p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <tr style="background:#f9fafb;">
        <th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:600;">Address</th>
        <th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:right;font-weight:600;">Price</th>
        <th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:right;font-weight:600;">Sold</th>
        <th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:right;font-weight:600;">Size</th>
        <th style="padding:8px 12px;font-size:12px;color:#6b7280;text-align:right;font-weight:600;">Dist</th>
      </tr>
      ${compRows}
    </table>
  </td></tr>` : ''}

  <!-- CTA -->
  <tr><td style="padding:32px;text-align:center;">
    <a href="${viewUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 32px;border-radius:8px;">
      View Full Deal Details
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
}
