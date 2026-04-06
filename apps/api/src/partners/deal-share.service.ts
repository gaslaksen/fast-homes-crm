import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { GmailService } from '../gmail/gmail.service';
import { DealPackageService } from './deal-package.service';
import { randomBytes } from 'crypto';

@Injectable()
export class DealShareService {
  private readonly logger = new Logger(DealShareService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private mailer: MailerService,
    private gmail: GmailService,
    private dealPackage: DealPackageService,
  ) {}

  async shareDeal(params: {
    leadId: string;
    partnerIds: string[];
    userId: string;
    orgId: string;
    channel?: 'resend' | 'gmail' | 'org-gmail';
    personalNote?: string;
    emailSubject?: string;
  }) {
    const { leadId, partnerIds, userId, orgId, channel = 'resend', personalNote, emailSubject } = params;

    if (partnerIds.length > 20) {
      throw new BadRequestException('Cannot share with more than 20 partners at once');
    }

    // Build the deal package (safe fields only)
    const pkg = await this.dealPackage.buildDealPackage(leadId);

    // Get sender info
    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true, organization: { select: { name: true } } },
    });

    // Get partners
    const partners = await this.prisma.partner.findMany({
      where: { id: { in: partnerIds }, organizationId: orgId, isActive: true },
    });

    if (partners.length === 0) {
      throw new BadRequestException('No valid partners found');
    }

    const frontendUrl = this.config.get('FRONTEND_URL') || 'http://localhost:3000';
    const senderName = sender ? `${sender.firstName} ${sender.lastName}` : undefined;
    const orgName = sender?.organization?.name;
    const subject = emailSubject || `Deal Opportunity: ${pkg.lead.propertyAddress}, ${pkg.lead.propertyCity}`;

    const shares = [];

    for (const partner of partners) {
      const viewToken = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      // Create share record with snapshot
      const share = await this.prisma.dealShare.create({
        data: {
          organizationId: orgId,
          leadId,
          partnerId: partner.id,
          sharedByUserId: userId,
          channel,
          viewToken,
          expiresAt,
          emailSubject: subject,
          personalNote,
          snapshotArv: pkg.analysis?.arvEstimate,
          snapshotRepairCosts: pkg.analysis?.repairCosts,
          snapshotMao: pkg.analysis?.mao,
          snapshotDealType: pkg.analysis?.dealType,
          snapshotAssignmentFee: pkg.analysis?.assignmentFee,
        },
      });

      const viewUrl = `${frontendUrl}/deal-view/${viewToken}`;
      const html = this.dealPackage.renderEmailHtml(pkg, {
        personalNote,
        viewUrl,
        senderName,
        orgName,
      });

      // Send email via selected channel
      try {
        if (channel === 'resend') {
          await this.mailer.sendDealPackage(
            partner.email,
            subject,
            html,
            sender?.email,
          );
        } else if (channel === 'gmail') {
          await this.gmail.sendEmail(userId, orgId, {
            to: partner.email,
            subject,
            bodyHtml: html,
            bodyText: `Deal opportunity: ${pkg.lead.propertyAddress}. View details: ${viewUrl}`,
            leadId,
          });
        } else if (channel === 'org-gmail') {
          await this.gmail.sendOrgEmail(orgId, {
            to: partner.email,
            subject,
            bodyHtml: html,
            bodyText: `Deal opportunity: ${pkg.lead.propertyAddress}. View details: ${viewUrl}`,
            leadId,
          });
        }
      } catch (err) {
        this.logger.error(`Failed to send deal share to ${partner.email}: ${err.message}`);
        await this.prisma.dealShare.update({
          where: { id: share.id },
          data: { status: 'error' },
        });
        shares.push({ ...share, status: 'error', partnerName: partner.name, partnerEmail: partner.email });
        continue;
      }

      // Update partner stats
      await this.prisma.partner.update({
        where: { id: partner.id },
        data: {
          lastSharedAt: new Date(),
          shareCount: { increment: 1 },
        },
      });

      shares.push({ ...share, partnerName: partner.name, partnerEmail: partner.email });
    }

    // Record activity on lead
    await this.prisma.activity.create({
      data: {
        leadId,
        userId,
        type: 'DEAL_SHARED',
        description: `Deal shared with ${partners.map((p) => p.name).join(', ')} via ${channel}`,
        metadata: {
          partnerIds: partners.map((p) => p.id),
          partnerNames: partners.map((p) => p.name),
          channel,
          shareCount: shares.filter((s) => s.status !== 'error').length,
        },
      },
    });

    // Update lead touch tracking
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        lastTouchedAt: new Date(),
        touchCount: { increment: 1 },
      },
    });

    return { shares, sent: shares.filter((s) => s.status !== 'error').length, failed: shares.filter((s) => s.status === 'error').length };
  }

  async trackOpen(viewToken: string) {
    const share = await this.prisma.dealShare.findUnique({
      where: { viewToken },
      include: {
        lead: {
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
          },
        },
        partner: { select: { name: true } },
      },
    });

    if (!share) throw new NotFoundException('Deal not found or link has expired');
    if (share.expiresAt < new Date()) throw new NotFoundException('This deal link has expired');

    // Update tracking
    const now = new Date();
    await this.prisma.dealShare.update({
      where: { id: share.id },
      data: {
        status: 'opened',
        openedAt: share.openedAt || now,
        lastOpenedAt: now,
        openCount: { increment: 1 },
      },
    });

    // Build fresh deal package for the view
    const pkg = await this.dealPackage.buildDealPackage(share.leadId);
    return {
      ...pkg,
      orgName: await this.getOrgName(share.organizationId),
      sharedAt: share.createdAt,
      partnerName: share.partner.name,
    };
  }

  private async getOrgName(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    return org?.name || 'Deal Core';
  }

  async getSharesForLead(leadId: string, orgId: string) {
    return this.prisma.dealShare.findMany({
      where: { leadId, organizationId: orgId },
      include: {
        partner: { select: { id: true, name: true, email: true, company: true, type: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSharesForPartner(partnerId: string, orgId: string) {
    return this.prisma.dealShare.findMany({
      where: { partnerId, organizationId: orgId },
      include: {
        lead: { select: { id: true, propertyAddress: true, propertyCity: true, propertyState: true, arv: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resendDeal(shareId: string, userId: string, orgId: string) {
    const share = await this.prisma.dealShare.findFirst({
      where: { id: shareId, organizationId: orgId },
      include: { partner: true },
    });
    if (!share) throw new NotFoundException('Share not found');

    const pkg = await this.dealPackage.buildDealPackage(share.leadId);
    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true, organization: { select: { name: true } } },
    });

    const frontendUrl = this.config.get('FRONTEND_URL') || 'http://localhost:3000';
    const viewUrl = `${frontendUrl}/deal-view/${share.viewToken}`;
    const html = this.dealPackage.renderEmailHtml(pkg, {
      personalNote: share.personalNote || undefined,
      viewUrl,
      senderName: sender ? `${sender.firstName} ${sender.lastName}` : undefined,
      orgName: sender?.organization?.name,
    });

    const subject = share.emailSubject || `Deal Opportunity: ${pkg.lead.propertyAddress}`;

    if (share.channel === 'resend') {
      await this.mailer.sendDealPackage(share.partner.email, subject, html, sender?.email);
    } else if (share.channel === 'gmail') {
      await this.gmail.sendEmail(userId, orgId, {
        to: share.partner.email,
        subject,
        bodyHtml: html,
        bodyText: `Deal opportunity: ${pkg.lead.propertyAddress}. View details: ${viewUrl}`,
        leadId: share.leadId,
      });
    } else if (share.channel === 'org-gmail') {
      await this.gmail.sendOrgEmail(orgId, {
        to: share.partner.email,
        subject,
        bodyHtml: html,
        bodyText: `Deal opportunity: ${pkg.lead.propertyAddress}. View details: ${viewUrl}`,
        leadId: share.leadId,
      });
    }

    // Extend expiration
    await this.prisma.dealShare.update({
      where: { id: share.id },
      data: {
        status: 'sent',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return { success: true };
  }
}
