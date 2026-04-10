import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PhotosService } from '../photos/photos.service';
import { randomBytes, randomInt } from 'crypto';

@Injectable()
export class SellerPortalService {
  private readonly logger = new Logger(SellerPortalService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private photosService: PhotosService,
  ) {}

  /**
   * Create a seller portal for a lead (one portal per lead).
   * Called automatically on lead creation.
   */
  async createPortal(leadId: string) {
    // Check if portal already exists
    const existing = await this.prisma.sellerPortal.findUnique({ where: { leadId } });
    if (existing) return existing;

    // Short 8-char alphanumeric token — SMS-friendly, avoids carrier spam filters
    // that flag long random URLs. 62^8 = 218 trillion combinations, collision-safe.
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let viewToken = '';
    for (let i = 0; i < 8; i++) {
      viewToken += chars[randomInt(chars.length)];
    }

    const portal = await this.prisma.sellerPortal.create({
      data: { leadId, viewToken },
    });

    this.logger.log(`Seller portal created for lead ${leadId}`);
    return portal;
  }

  /**
   * Get portal info for CRM agents (authenticated).
   */
  async getPortalInfo(leadId: string) {
    const portal = await this.prisma.sellerPortal.findUnique({ where: { leadId } });
    if (!portal) return null;

    const frontendUrl = this.config.get('FRONTEND_URL') || 'http://localhost:3000';
    return {
      ...portal,
      portalUrl: `${frontendUrl}/seller/${portal.viewToken}`,
    };
  }

  /**
   * Get the portal URL for a lead (used by AI messaging).
   */
  async getPortalUrl(leadId: string): Promise<string | null> {
    const portal = await this.prisma.sellerPortal.findUnique({ where: { leadId } });
    if (!portal || portal.status !== 'active') return null;

    const frontendUrl = this.config.get('FRONTEND_URL') || 'http://localhost:3000';
    return `${frontendUrl}/seller/${portal.viewToken}`;
  }

  /**
   * Public: get seller-facing package by token.
   * Tracks opens and returns sanitized data (no ARV, MAO, etc.).
   */
  async getSellerPackageByToken(token: string) {
    const portal = await this.prisma.sellerPortal.findUnique({
      where: { viewToken: token },
    });

    if (!portal) throw new NotFoundException('Portal not found');
    if (portal.status !== 'active') throw new NotFoundException('This portal is no longer available');

    // Track open
    const now = new Date();
    await this.prisma.sellerPortal.update({
      where: { id: portal.id },
      data: {
        openedAt: portal.openedAt || now,
        lastOpenedAt: now,
        openCount: { increment: 1 },
      },
    });

    return this.buildSellerPackage(portal.leadId);
  }

  /**
   * Build seller-safe data package.
   * CRITICAL: No ARV, MAO, repair costs, assignment fee, deal intelligence, scoring, or AI analysis.
   */
  private async buildSellerPackage(leadId: string) {
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
        sellerFirstName: true,
        assignedToUserId: true,
        organizationId: true,
      },
    });
    if (!lead) throw new NotFoundException('Property not found');

    // Get selected comps from latest analysis (sanitized — only public sold data)
    const analysis = await this.prisma.compAnalysis.findFirst({
      where: { leadId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });

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
          },
          orderBy: { distance: 'asc' },
          take: 8,
        })
      : [];

    // Get visible offers
    const offers = await this.prisma.offer.findMany({
      where: { leadId, visibleOnPortal: true },
      select: {
        id: true,
        offerAmount: true,
        offerDate: true,
        status: true,
        terms: true,
        sellerRespondedAt: true,
      },
      orderBy: { offerDate: 'desc' },
    });

    // Get agent contact info
    let agent: { name: string; phone: string | null; email: string } | null = null;
    if (lead.assignedToUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: lead.assignedToUserId },
        select: { firstName: true, lastName: true, email: true, phone: true },
      });
      if (user) {
        agent = {
          name: `${user.firstName} ${user.lastName}`.trim(),
          phone: user.phone || null,
          email: user.email,
        };
      }
    }

    // Get org name for branding
    let orgName = 'Quick Cash Home Buyers';
    if (lead.organizationId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: lead.organizationId },
        select: { name: true },
      });
      if (org?.name) orgName = org.name;
    }

    return {
      property: {
        address: lead.propertyAddress,
        city: lead.propertyCity,
        state: lead.propertyState,
        zip: lead.propertyZip,
        type: lead.propertyType,
        bedrooms: lead.bedrooms,
        bathrooms: lead.bathrooms,
        sqft: lead.sqftOverride || lead.sqft,
        yearBuilt: lead.yearBuilt,
        lotSize: lead.lotSize,
        stories: lead.stories,
        primaryPhoto: lead.primaryPhoto,
        photos: lead.photos || [],
        latitude: lead.latitude,
        longitude: lead.longitude,
      },
      sellerFirstName: lead.sellerFirstName,
      comps: comps.map((c) => ({
        address: c.address,
        soldPrice: c.soldPrice,
        soldDate: c.soldDate.toISOString().split('T')[0],
        sqft: c.sqft,
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        yearBuilt: c.yearBuilt,
        distance: c.distance,
      })),
      offers,
      agent,
      orgName,
    };
  }

  /**
   * Public: upload photos from seller portal.
   */
  async uploadSellerPhotos(token: string, files: Express.Multer.File[]) {
    const portal = await this.prisma.sellerPortal.findUnique({ where: { viewToken: token } });
    if (!portal) throw new NotFoundException('Portal not found');
    if (portal.status !== 'active') throw new BadRequestException('This portal is no longer available');

    // Cap at 50 total photos per lead
    const lead = await this.prisma.lead.findUnique({
      where: { id: portal.leadId },
      select: { photos: true },
    });
    const currentCount = ((lead?.photos as any[]) || []).length;
    if (currentCount + files.length > 50) {
      throw new BadRequestException(`Photo limit reached. You can upload up to ${50 - currentCount} more photos.`);
    }

    const results = [];
    for (const file of files) {
      const photo = await this.photosService.processAndSave(
        portal.leadId,
        file.buffer,
        'seller-portal',
      );
      results.push(photo);
    }

    this.logger.log(`Seller uploaded ${files.length} photos for lead ${portal.leadId}`);
    return { success: true, photoCount: results.length, photos: results };
  }

  /**
   * Public: seller responds to an offer.
   */
  async respondToOffer(token: string, offerId: string, response: 'accepted' | 'declined') {
    const portal = await this.prisma.sellerPortal.findUnique({ where: { viewToken: token } });
    if (!portal) throw new NotFoundException('Portal not found');
    if (portal.status !== 'active') throw new BadRequestException('This portal is no longer available');

    const offer = await this.prisma.offer.findFirst({
      where: { id: offerId, leadId: portal.leadId, visibleOnPortal: true },
    });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.status !== 'pending') throw new BadRequestException('This offer has already been responded to');

    const newStatus = response === 'accepted' ? 'accepted' : 'rejected';

    await this.prisma.offer.update({
      where: { id: offerId },
      data: { status: newStatus, sellerRespondedAt: new Date() },
    });

    // Log activity
    await this.prisma.activity.create({
      data: {
        leadId: portal.leadId,
        type: 'OFFER_RESPONSE',
        description: `Seller ${response} offer of $${offer.offerAmount.toLocaleString()} via portal`,
        metadata: { offerId, response, offerAmount: offer.offerAmount },
      },
    });

    // If accepted, advance lead status
    if (response === 'accepted') {
      await this.prisma.lead.update({
        where: { id: portal.leadId },
        data: { status: 'UNDER_CONTRACT' },
      });
    }

    this.logger.log(`Seller ${response} offer ${offerId} for lead ${portal.leadId}`);
    return { success: true, status: newStatus };
  }

  /**
   * Regenerate the portal token (replaces old long token with short one).
   */
  async regenerateToken(leadId: string) {
    const portal = await this.prisma.sellerPortal.findUnique({ where: { leadId } });
    if (!portal) throw new NotFoundException('No portal found for this lead');

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let newToken = '';
    for (let i = 0; i < 8; i++) {
      newToken += chars[randomInt(chars.length)];
    }

    await this.prisma.sellerPortal.update({
      where: { id: portal.id },
      data: { viewToken: newToken, portalLinkSentAt: null },
    });

    this.logger.log(`Portal token regenerated for lead ${leadId}`);
    return this.getPortalInfo(leadId);
  }

  /**
   * Enable or disable a portal (CRM agent action).
   */
  async updatePortalStatus(leadId: string, status: 'active' | 'disabled') {
    const portal = await this.prisma.sellerPortal.findUnique({ where: { leadId } });
    if (!portal) throw new NotFoundException('No portal found for this lead');

    await this.prisma.sellerPortal.update({
      where: { id: portal.id },
      data: { status },
    });

    return { success: true, status };
  }

  /**
   * Mark portal link as sent (prevents duplicate auto-sends).
   */
  async markPortalLinkSent(leadId: string) {
    const portal = await this.prisma.sellerPortal.findUnique({ where: { leadId } });
    if (!portal) return;

    await this.prisma.sellerPortal.update({
      where: { id: portal.id },
      data: { portalLinkSentAt: new Date() },
    });
  }

  /**
   * Check if portal link has been sent.
   */
  async hasPortalLinkBeenSent(leadId: string): Promise<boolean> {
    const portal = await this.prisma.sellerPortal.findUnique({ where: { leadId } });
    return !!portal?.portalLinkSentAt;
  }
}
