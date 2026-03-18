import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const BOLDSIGN_API = 'https://api.boldsign.com';
const BOLDSIGN_KEY =
  process.env.BOLDSIGN_API_KEY ||
  'Zjg2OWNhZDMtZmU4MS00YzZlLThjZDQtZTg1MWVhOTg0MWQx';

const PURCHASE_CONTRACT_TEMPLATE = '07f21edb-5c6a-4287-8cf1-27f5b44d83d0';
const AIF_NOTARY_TEMPLATE = '555f6321-66aa-4e0f-a44d-3e20473e2211';

@Injectable()
export class BoldSignService {
  private readonly logger = new Logger(BoldSignService.name);

  constructor(private prisma: PrismaService) {}

  private headers() {
    return { 'X-API-KEY': BOLDSIGN_KEY, 'Content-Type': 'application/json' };
  }

  /** List available templates */
  async listTemplates() {
    const res = await fetch(
      `${BOLDSIGN_API}/v1/template/list?page=1&pageSize=20`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`BoldSign template list failed: ${res.status}`);
    return res.json();
  }

  /** Send a document for signature from a template */
  async sendDocument(leadId: string, templateType: 'purchase' | 'aif') {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { contract: true },
    });
    if (!lead) throw new Error('Lead not found');
    if (!lead.sellerEmail)
      throw new Error('Seller email is required to send for signature');

    const templateId =
      templateType === 'purchase'
        ? PURCHASE_CONTRACT_TEMPLATE
        : AIF_NOTARY_TEMPLATE;
    const contract = lead.contract;

    const sellerName =
      `${lead.sellerFirstName} ${lead.sellerLastName}`.trim();
    const propertyAddress = [
      lead.propertyAddress,
      lead.propertyCity,
      lead.propertyState,
      lead.propertyZip,
    ]
      .filter(Boolean)
      .join(', ');
    const offerAmt = contract?.offerAmount
      ? `$${Math.round(contract.offerAmount).toLocaleString()}`
      : '';
    const earnest = contract?.earnestMoney
      ? `$${Math.round(contract.earnestMoney).toLocaleString()}`
      : '';
    const inspPeriod = contract?.inspectionPeriodDays
      ? String(contract.inspectionPeriodDays)
      : '';
    const titleCo = contract?.titleCompany || '';

    // Build roles with pre-filled fields
    let roles: any[];

    if (templateType === 'purchase') {
      roles = [
        {
          roleIndex: 1,
          signerName: sellerName,
          signerEmail: lead.sellerEmail,
          formFields: [
            { id: 'Name1', value: sellerName },
            { id: 'Name2', value: sellerName },
            { id: 'Name3', value: sellerName },
            { id: 'Name4', value: sellerName },
            { id: 'Name5', value: sellerName },
            { id: 'Name7', value: sellerName },
            { id: 'Email1', value: lead.sellerEmail },
            { id: 'TextBox1', value: propertyAddress },
            { id: 'TextBox5', value: offerAmt },
            { id: 'TextBox8', value: earnest },
            { id: 'TextBox9', value: inspPeriod },
            { id: 'TextBox10', value: titleCo },
          ].filter((f) => f.value),
        },
        {
          roleIndex: 2,
          signerName: 'ESL 1 LLC',
          signerEmail: process.env.BUYER_EMAIL || 'gaslaksen@gmail.com',
          formFields: [],
        },
      ];
    } else {
      // AIF with Notary
      roles = [
        {
          roleIndex: 1,
          signerName: sellerName,
          signerEmail: lead.sellerEmail,
          formFields: [
            { id: 'Name1', value: sellerName },
            { id: 'TextBox1', value: propertyAddress },
          ].filter((f) => f.value),
        },
        {
          roleIndex: 2,
          signerName: 'ESL 1 LLC',
          signerEmail: process.env.BUYER_EMAIL || 'gaslaksen@gmail.com',
          formFields: [],
        },
      ];
    }

    const docTitle =
      templateType === 'purchase'
        ? `Purchase Contract - ${lead.propertyAddress}`
        : `AIF with Notary - ${lead.propertyAddress}`;

    const body = {
      templateId,
      title: docTitle,
      message:
        templateType === 'purchase'
          ? `Please review and sign the purchase contract for ${lead.propertyAddress}.`
          : `Please review and sign the Attorney in Fact document for ${lead.propertyAddress}.`,
      roles,
      expiryDays: 30,
    };

    this.logger.log(
      `Sending BoldSign ${templateType} for lead ${leadId}: ${docTitle}`,
    );

    const res = await fetch(`${BOLDSIGN_API}/v1/template/send`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    const responseText = await res.text();
    if (!res.ok) {
      this.logger.error(`BoldSign send failed: ${res.status} ${responseText}`);
      throw new Error(`BoldSign send failed: ${res.status} - ${responseText}`);
    }

    let docData: any = {};
    try {
      docData = JSON.parse(responseText);
    } catch {}

    const documentId = docData.documentId || docData.id || '';

    // Get signing URL for the seller
    let signingUrl = '';
    if (documentId) {
      try {
        const sigRes = await fetch(
          `${BOLDSIGN_API}/v1/document/getEmbeddedSignLink?documentId=${documentId}&signerEmail=${encodeURIComponent(lead.sellerEmail)}&redirectUrl=`,
          { headers: this.headers() },
        );
        if (sigRes.ok) {
          const sigData = await sigRes.json();
          signingUrl = sigData.signLink || '';
        }
      } catch {}
    }

    // Update or create contract record
    if (contract) {
      await this.prisma.contract.update({
        where: { id: contract.id },
        data: {
          boldsignDocumentId: documentId,
          boldsignStatus: 'pending',
          boldsignSigningUrl: signingUrl,
          boldsignSentAt: new Date(),
        },
      });
    } else {
      await this.prisma.contract.create({
        data: {
          leadId,
          contractStatus: 'draft',
          exitStrategy: 'wholesale',
          boldsignDocumentId: documentId,
          boldsignStatus: 'pending',
          boldsignSigningUrl: signingUrl,
          boldsignSentAt: new Date(),
        },
      });
    }

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'DOCUMENT_SENT',
        description: `${templateType === 'purchase' ? 'Purchase Contract' : 'AIF with Notary'} sent for signature via BoldSign`,
        metadata: {
          documentId,
          templateType,
          recipientEmail: lead.sellerEmail,
        },
      },
    });

    return { documentId, signingUrl, title: docTitle };
  }

  /** Check signing status for a document */
  async getDocumentStatus(documentId: string) {
    const res = await fetch(
      `${BOLDSIGN_API}/v1/document/properties?documentId=${documentId}`,
      { headers: this.headers() },
    );
    if (!res.ok)
      throw new Error(`BoldSign status check failed: ${res.status}`);
    const data = await res.json();

    const signers = data.signerDetails || [];
    const allSigned = signers.every(
      (s: any) => s.status === 'Completed',
    );
    const anyDeclined = signers.some(
      (s: any) => s.status === 'Declined',
    );
    const status = anyDeclined
      ? 'declined'
      : allSigned
        ? 'completed'
        : 'pending';

    return { status, signers, documentId, documentStatus: data.status };
  }

  /** Sync status from BoldSign to contract record */
  async syncContractStatus(leadId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { leadId },
    });
    if (!contract || !contract.boldsignDocumentId) return null;

    const status = await this.getDocumentStatus(
      contract.boldsignDocumentId,
    );

    let contractStatus = contract.contractStatus;
    if (status.status === 'completed') contractStatus = 'signed';
    if (status.status === 'declined') contractStatus = 'cancelled';

    await this.prisma.contract.update({
      where: { id: contract.id },
      data: {
        boldsignStatus: status.status,
        contractStatus,
      },
    });

    return status;
  }
}
