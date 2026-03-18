import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const BOLDSIGN_API = 'https://api.boldsign.com';
const BOLDSIGN_KEY =
  process.env.BOLDSIGN_API_KEY ||
  'Zjg2OWNhZDMtZmU4MS00YzZlLThjZDQtZTg1MWVhOTg0MWQx';

const PURCHASE_CONTRACT_TEMPLATE = '07f21edb-5c6a-4287-8cf1-27f5b44d83d0';
const AIF_NOTARY_TEMPLATE = '555f6321-66aa-4e0f-a44d-3e20473e2211';
const BUYER_EMAIL = process.env.BUYER_EMAIL || 'gaslaksen@gmail.com';

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

    const sellerName = `${lead.sellerFirstName} ${lead.sellerLastName}`.trim();
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
      ? `${contract.inspectionPeriodDays}`
      : '';
    const titleCo = contract?.titleCompany || '';

    const docTitle =
      templateType === 'purchase'
        ? `Purchase Contract - ${lead.propertyAddress}`
        : `AIF with Notary - ${lead.propertyAddress}`;

    // ── Step 1: Send from template (templateId MUST be a query param) ──────
    // Roles only include signerName/signerEmail — no formFields with bounds needed.
    // BoldSign auto-fills Name-type fields from signerName.
    const sendBody = {
      title: docTitle,
      message:
        templateType === 'purchase'
          ? `Please review and sign the purchase contract for ${lead.propertyAddress}.`
          : `Please review and sign the Attorney in Fact document for ${lead.propertyAddress}.`,
      roles: [
        {
          roleIndex: 1,
          signerName: sellerName,
          signerEmail: lead.sellerEmail,
        },
        {
          roleIndex: 2,
          signerName: 'ESL 1 LLC',
          signerEmail: BUYER_EMAIL,
        },
      ],
      expiryDays: 30,
    };

    this.logger.log(`Sending BoldSign ${templateType} for lead ${leadId}: ${docTitle}`);

    const sendRes = await fetch(
      `${BOLDSIGN_API}/v1/template/send?templateId=${templateId}`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(sendBody),
      },
    );

    const sendText = await sendRes.text();
    if (!sendRes.ok) {
      this.logger.error(`BoldSign send failed: ${sendRes.status} ${sendText}`);
      throw new Error(`BoldSign send failed: ${sendRes.status} - ${sendText}`);
    }

    let docData: any = {};
    try { docData = JSON.parse(sendText); } catch {}
    const documentId: string = docData.documentId || docData.id || '';

    if (!documentId) {
      throw new Error('BoldSign returned no documentId');
    }

    this.logger.log(`BoldSign document created: ${documentId}`);

    // ── Step 2: Pre-fill TextBox fields via prefillFields ─────────────────
    // Name-type fields can't be prefilled; they auto-populate from signerName.
    // TextBox/textbox fields can be prefilled with id + value only (no bounds).
    const prefillFields: { id: string; value: string }[] = [];

    if (templateType === 'purchase') {
      if (propertyAddress) prefillFields.push({ id: 'TextBox1', value: propertyAddress });
      if (offerAmt) prefillFields.push({ id: 'TextBox5', value: offerAmt });
      if (earnest) prefillFields.push({ id: 'TextBox8', value: earnest });
      if (inspPeriod) prefillFields.push({ id: 'TextBox9', value: inspPeriod });
      if (titleCo) prefillFields.push({ id: 'TextBox10', value: titleCo });
    } else {
      if (propertyAddress) prefillFields.push({ id: 'TextBox1', value: propertyAddress });
    }

    if (prefillFields.length > 0) {
      try {
        const prefillRes = await fetch(
          `${BOLDSIGN_API}/v1/document/prefillFields?documentId=${documentId}`,
          {
            method: 'PATCH',
            headers: this.headers(),
            body: JSON.stringify({ fields: prefillFields }),
          },
        );
        if (!prefillRes.ok) {
          const prefillErr = await prefillRes.text();
          this.logger.warn(`BoldSign prefill warning (non-fatal): ${prefillRes.status} ${prefillErr}`);
        } else {
          this.logger.log(`BoldSign prefilled ${prefillFields.length} fields on ${documentId}`);
        }
      } catch (err: any) {
        this.logger.warn(`BoldSign prefill failed (non-fatal): ${err.message}`);
      }
    }

    // ── Step 3: Get the seller's direct signing link ───────────────────────
    let signingUrl = '';
    try {
      const sigRes = await fetch(
        `${BOLDSIGN_API}/v1/document/getEmbeddedSignLink?documentId=${documentId}&signerEmail=${encodeURIComponent(lead.sellerEmail)}&redirectUrl=`,
        { headers: this.headers() },
      );
      if (sigRes.ok) {
        const sigData = await sigRes.json();
        signingUrl = sigData.signLink || '';
      }
    } catch (err: any) {
      this.logger.warn(`Could not get signing link: ${err.message}`);
    }

    // ── Step 4: Persist to contract record ────────────────────────────────
    const contractData: any = {
      boldsignDocumentId: documentId,
      boldsignStatus: 'pending',
      boldsignSigningUrl: signingUrl,
      boldsignSentAt: new Date(),
    };

    if (contract) {
      await this.prisma.contract.update({
        where: { id: contract.id },
        data: contractData,
      });
    } else {
      await this.prisma.contract.create({
        data: {
          leadId,
          contractStatus: 'draft',
          exitStrategy: 'wholesale',
          ...contractData,
        },
      });
    }

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId,
        type: 'DOCUMENT_SENT',
        description: `${templateType === 'purchase' ? 'Purchase Contract' : 'AIF with Notary'} sent for signature via BoldSign to ${lead.sellerEmail}`,
        metadata: { documentId, templateType, recipientEmail: lead.sellerEmail },
      },
    });

    this.logger.log(`✅ BoldSign ${templateType} sent for lead ${leadId}, doc ${documentId}`);
    return { documentId, signingUrl, title: docTitle };
  }

  /** Check and sync signing status from BoldSign */
  async syncContractStatus(leadId: string) {
    const contract = await this.prisma.contract.findUnique({ where: { leadId } });
    if (!contract || !(contract as any).boldsignDocumentId) {
      return { status: 'not_sent', message: 'No BoldSign document on file' };
    }

    const documentId = (contract as any).boldsignDocumentId as string;
    const res = await fetch(
      `${BOLDSIGN_API}/v1/document/properties?documentId=${documentId}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`BoldSign status check failed: ${res.status}`);
    const data = await res.json();

    const signers = data.signerDetails || [];
    const allSigned = signers.length > 0 && signers.every((s: any) => s.status === 'Completed');
    const anyDeclined = signers.some((s: any) => s.status === 'Declined');
    const status = anyDeclined ? 'declined' : allSigned ? 'completed' : 'pending';

    // Update contract status in DB
    const contractStatusMap: Record<string, string> = {
      completed: 'signed',
      declined: 'cancelled',
      pending: contract.contractStatus,
    };

    await this.prisma.contract.update({
      where: { id: contract.id },
      data: {
        boldsignStatus: status,
        contractStatus: contractStatusMap[status] || contract.contractStatus,
      } as any,
    });

    return { status, documentId, signers: signers.map((s: any) => ({
      name: s.signerName,
      email: s.signerEmail,
      status: s.status,
    }))};
  }
}
