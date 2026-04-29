import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class SlackLeadService {
  private readonly logger = new Logger(SlackLeadService.name);

  // ─── Parse lead notification message ──────────────────────────────────────

  parseLeadNotification(text: string): {
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    fullAddress?: string;
  } | null {
    // Expected format:
    // :boltdeals: New Lead in the CRM:
    // Name: Kelly Hensley
    // Phone: +19407334533
    // Email: koltonhensley@outlook.com
    // Address: 1225 W. Belknap St. 76458

    if (!text.includes('New Lead in the CRM')) return null;

    const name = text.match(/Name:\s*(.+)/i)?.[1]?.trim();
    const phone = text.match(/Phone:\s*(.+)/i)?.[1]?.trim();
    const email = text.match(/Email:\s*(.+)/i)?.[1]?.trim();
    const addressLine = text.match(/Address:\s*(.+)/i)?.[1]?.trim();

    // Bolt Deals sometimes splits the address into separate labelled lines.
    const cityLine = text.match(/City:\s*(.+)/i)?.[1]?.trim();
    const stateLine = text.match(/State:\s*(.+)/i)?.[1]?.trim();
    const zipLine = text
      .match(/(?:Zip|Zipcode|Zip Code|Postal Code|Postcode):\s*(.+)/i)?.[1]
      ?.trim();

    if (!addressLine) return null;

    let address: string;
    let city: string | undefined = cityLine;
    let state: string | undefined = stateLine;
    let zip: string | undefined = zipLine;

    if (cityLine || stateLine || zipLine) {
      // Multi-field format: address line is just the street; structured fields
      // carry the rest. Trust them as-is.
      address = addressLine;
    } else {
      // Single-line format: zip may be embedded at the end of the address.
      const zipMatch = addressLine.match(/(\d{5})(?:-\d{4})?$/);
      zip = zipMatch?.[1];
      address = addressLine.replace(/\s*\d{5}(?:-\d{4})?$/, '').trim();
    }

    const fullAddress = [address, city, state, zip].filter(Boolean).join(' ');

    return { name, phone, email, address, city, state, zip, fullAddress };
  }

  // ─── Post a minimal lead acknowledgement to Slack ─────────────────────────

  async analyzeAndPost(params: {
    text: string;
    responseUrl: string;
    channelId?: string;
  }): Promise<void> {
    const lead = this.parseLeadNotification(params.text);

    if (!lead?.fullAddress) {
      this.logger.warn('Could not parse address from Slack notification');
      await this.postToSlack(params.responseUrl, {
        text: '⚠️ TRON: Could not parse address from lead notification.',
      });
      return;
    }

    this.logger.log(`Lead received via Slack: ${lead.fullAddress}`);

    const fields: Array<{ type: string; text: string }> = [
      { type: 'mrkdwn', text: `*Seller:*\n${lead.name || 'Unknown'}` },
      { type: 'mrkdwn', text: `*Phone:*\n${lead.phone || '—'}` },
      { type: 'mrkdwn', text: `*Address:*\n${lead.address}${lead.zip ? ' ' + lead.zip : ''}` },
    ];
    if (lead.email) fields.push({ type: 'mrkdwn', text: `*Email:*\n${lead.email}` });

    await this.postToSlack(params.responseUrl, {
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '🏠 New Lead Received' } },
        { type: 'section', fields },
      ],
    });
  }

  // ─── Post to Slack via webhook URL ────────────────────────────────────────

  private async postToSlack(webhookUrl: string, payload: any): Promise<void> {
    if (!webhookUrl) return;
    try {
      await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
    } catch (err: any) {
      this.logger.error('Failed to post to Slack:', err?.message ?? err);
    }
  }
}
