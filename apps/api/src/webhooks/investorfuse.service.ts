import { Injectable, Logger } from '@nestjs/common';
import { LeadsService } from '../leads/leads.service';
import { RentCastService } from '../comps/rentcast.service';
import { LeadSource } from '@fast-homes/shared';
import * as fs from 'fs';

/**
 * Handles InvestorFuse "opportunity created" webhooks.
 *
 * Flow:
 *   InvestorFuse fires webhook → parse lead → create in DB → auto-fetch comps
 *
 * By the time you open the lead in fast-homes-crm, comps are already there.
 *
 * On first receipt, saves raw payload to /tmp/investorfuse-sample.json
 * so field mapping can be verified/adjusted.
 */
@Injectable()
export class InvestorFuseService {
  private readonly logger = new Logger(InvestorFuseService.name);
  private sampleSaved = false; // resets on each API restart — captures first real payload

  constructor(
    private leadsService: LeadsService,
    private rentcast: RentCastService,
  ) {}

  // ─── Parse InvestorFuse payload ───────────────────────────────────────────

  parseLead(body: any) {
    // InvestorFuse sends a flat payload with seller_ prefixed fields.
    // Falls back to nested contact/property objects for flexibility.
    const contact  = body.contact  || body.Contact  || body;
    const property = body.property || body.Property || body;

    // Name — IF uses seller_first_name / seller_last_name at top level
    const firstName =
      body.seller_first_name || contact.first_name || contact.firstName || '';
    const lastName =
      body.seller_last_name  || contact.last_name  || contact.lastName  || '';
    const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';

    // Contact info — IF uses seller_phone / seller_email at top level
    const phone =
      body.seller_phone || contact.phone || contact.phone_number || '';
    const email =
      body.seller_email || contact.email || '';

    // Address — IF uses street_address + city/state/zipcode at top level
    const street =
      body.street_address || body.seller_address ||
      property.street || property.street_address || property.address || '';
    const city =
      body.city  || property.city  || '';
    const state =
      body.state || property.state || '';
    const zip =
      body.zipcode || body.zip_code || body.zip ||
      property.zipcode || property.zip || '';

    if (!street) return null;

    // Optional deal details
    const rawAskingPrice = body.asking_price || body.askingPrice;
    const rawBedrooms    = body.bedrooms  || property.bedrooms;
    const rawBathrooms   = body.bathrooms || property.bathrooms;
    const rawSqft        = body.sqft      || property.sqft || property.square_feet;
    const rawPropertyType = body.property_type || property.property_type;

    const sourceStr = body.lead_source || body.source || body.campaign_name || '';
    const source = sourceStr.toLowerCase().includes('google')
      ? LeadSource.GOOGLE_ADS
      : LeadSource.PROPERTY_LEADS;

    return {
      // Contact
      sellerFirstName: firstName || fullName.split(' ')[0] || 'Unknown',
      sellerLastName: lastName || fullName.split(' ').slice(1).join(' ') || '',
      sellerPhone: phone,
      sellerEmail: email,
      // Property
      propertyAddress: street,
      propertyCity: city,
      propertyState: state,
      propertyZip: zip,
      // Deal details (if IF sends them)
      askingPrice: rawAskingPrice ? parseFloat(rawAskingPrice) : undefined,
      bedrooms: rawBedrooms ? parseInt(rawBedrooms) : undefined,
      bathrooms: rawBathrooms ? parseFloat(rawBathrooms) : undefined,
      sqft: rawSqft ? parseInt(rawSqft) : undefined,
      propertyType: rawPropertyType || undefined,
      // Meta
      source,
      sourceMetadata: body,
    };
  }

  // ─── Main handler ─────────────────────────────────────────────────────────

  async handleOpportunityCreated(body: any): Promise<{ success: boolean; leadId?: string; message: string }> {
    // Save sample payload once for field verification
    if (!this.sampleSaved) {
      try {
        fs.writeFileSync('/tmp/investorfuse-sample.json', JSON.stringify(body, null, 2));
        this.logger.log('📄 Saved IF sample payload → /tmp/investorfuse-sample.json');
      } catch {}
      this.sampleSaved = true;
    }

    const leadData = this.parseLead(body);

    if (!leadData) {
      this.logger.error('Could not parse address from IF payload — check /tmp/investorfuse-sample.json');
      return { success: false, message: 'Could not parse address from payload' };
    }

    const fullAddress = [
      leadData.propertyAddress,
      leadData.propertyCity,
      leadData.propertyState,
      leadData.propertyZip,
    ].filter(Boolean).join(', ');

    this.logger.log(`📥 InvestorFuse lead: ${leadData.sellerFirstName} ${leadData.sellerLastName} | ${fullAddress}`);

    // ── Create lead in DB ──
    let lead: any;
    try {
      lead = await this.leadsService.createLead(leadData);
      this.logger.log(`✅ Lead created: ${lead.id}`);
    } catch (err) {
      this.logger.error('Failed to create lead:', err.message);
      return { success: false, message: `Failed to create lead: ${err.message}` };
    }

    // ── Auto-fetch comps in background (non-blocking) ──
    // By the time Geoff opens the lead, comps are ready.
    setImmediate(async () => {
      try {
        this.logger.log(`🔍 Auto-fetching comps for lead ${lead.id}: ${fullAddress}`);
        const result = await this.rentcast.fetchAndSaveComps(lead.id, {
          street: leadData.propertyAddress,
          city: leadData.propertyCity,
          state: leadData.propertyState,
          zip: leadData.propertyZip,
        });
        this.logger.log(
          `✅ Comps ready for lead ${lead.id}: ARV $${result.arv.toLocaleString()}, ` +
          `${result.compsCount} comps, ${result.confidence}% confidence`
        );
      } catch (err) {
        this.logger.warn(`⚠️  Comp fetch failed for lead ${lead.id}: ${err.message}`);
      }
    });

    return {
      success: true,
      leadId: lead.id,
      message: `Lead created (${lead.id}) — comps fetching in background`,
    };
  }
}
