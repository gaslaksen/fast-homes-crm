import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Thin wrapper around the GoHighLevel (LeadConnector) REST API.
 *
 * Auth: a single Private Integration token in the GHL_API_TOKEN env var.
 * Token is scoped per location in GHL; we accept any locationId since the
 * token itself encodes which location it can act on.
 *
 * Docs:
 *   https://marketplace.gohighlevel.com/docs/ghl/conversations/get-conversation
 *   https://marketplace.gohighlevel.com/docs/ghl/conversations/send-a-new-message
 *   https://marketplace.gohighlevel.com/docs/ghl/contacts/get-contact
 */

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

export type GhlMessage = {
  id?: string;
  body?: string;
  direction?: 'inbound' | 'outbound';
  messageType?: string;          // "SMS" | "Email" | etc.
  type?: number;                  // legacy numeric type
  dateAdded?: string;
  contactId?: string;
  conversationId?: string;
};

export type GhlContact = {
  id?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
};

@Injectable()
export class GhlClient {
  private readonly logger = new Logger(GhlClient.name);

  constructor(private config: ConfigService) {}

  private token(): string {
    const t = this.config.get<string>('GHL_API_TOKEN');
    if (!t) throw new Error('GHL_API_TOKEN env var is not set');
    return t;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: any): Promise<T> {
    const url = `${GHL_BASE_URL}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token()}`,
        Version: GHL_API_VERSION,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    if (!res.ok) {
      this.logger.error(`GHL ${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
      throw new Error(`GHL API error ${res.status}: ${text.slice(0, 200)}`);
    }

    try {
      return text ? (JSON.parse(text) as T) : ({} as T);
    } catch {
      this.logger.error(`GHL ${method} ${path} returned non-JSON: ${text.slice(0, 200)}`);
      throw new Error('GHL API returned non-JSON response');
    }
  }

  /**
   * Fetch the most recent messages on a conversation. GHL returns newest
   * first; we reverse to oldest-first to match our internal convention.
   * Capped to ~30 messages by default - more than enough conversation
   * context for the AI to generate the next reply.
   */
  async getConversationMessages(conversationId: string, limit = 30): Promise<GhlMessage[]> {
    const path = `/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`;
    const raw = await this.request<any>('GET', path);

    // GHL returns either { messages: { messages: [...] } } or { messages: [...] }
    // depending on endpoint version. Handle both defensively.
    let arr: any[] = [];
    if (Array.isArray(raw?.messages?.messages)) arr = raw.messages.messages;
    else if (Array.isArray(raw?.messages))      arr = raw.messages;
    else if (Array.isArray(raw))                arr = raw;

    // Oldest first
    return [...arr].sort((a, b) => {
      const ta = a?.dateAdded ? new Date(a.dateAdded).getTime() : 0;
      const tb = b?.dateAdded ? new Date(b.dateAdded).getTime() : 0;
      return ta - tb;
    });
  }

  async getContact(contactId: string): Promise<GhlContact> {
    const path = `/contacts/${encodeURIComponent(contactId)}`;
    const raw = await this.request<any>('GET', path);
    // GHL wraps contact in { contact: {...} } on some endpoints
    return raw?.contact ?? raw ?? {};
  }

  /**
   * Send an SMS via GHL. Returns whatever GHL returns (typically the new
   * message ID). Throws on failure - caller is responsible for logging.
   */
  async sendSms(input: { contactId: string; conversationId?: string; body: string; locationId?: string }): Promise<any> {
    const payload: Record<string, any> = {
      type: 'SMS',
      contactId: input.contactId,
      message: input.body,
    };
    if (input.conversationId) payload.conversationId = input.conversationId;
    if (input.locationId) payload.locationId = input.locationId;

    return this.request<any>('POST', '/conversations/messages', payload);
  }
}
