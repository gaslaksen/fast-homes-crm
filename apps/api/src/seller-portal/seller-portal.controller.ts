import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Req,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SellerPortalService } from './seller-portal.service';

const UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  fileFilter: (_req: any, file: any, cb: any) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new BadRequestException('Only image files are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
};

@Controller()
export class SellerPortalController {
  constructor(private sellerPortalService: SellerPortalService) {}

  // ── Public endpoints (no auth, token-validated) ──────────────────────────

  @Get('seller-portal/:token')
  async getSellerPackage(@Param('token') token: string) {
    return this.sellerPortalService.getSellerPackageByToken(token);
  }

  @Post('seller-portal/:token/photos')
  @UseInterceptors(FilesInterceptor('photos', 10, UPLOAD_OPTIONS))
  async uploadSellerPhotos(
    @Param('token') token: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    if (!files || files.length === 0) throw new BadRequestException('No files provided');
    return this.sellerPortalService.uploadSellerPhotos(token, files);
  }

  @Post('seller-portal/:token/offers/:offerId/respond')
  async respondToOffer(
    @Param('token') token: string,
    @Param('offerId') offerId: string,
    @Body() body: { response: 'accepted' | 'declined' },
  ) {
    if (!body.response || !['accepted', 'declined'].includes(body.response)) {
      throw new BadRequestException('Response must be "accepted" or "declined"');
    }
    return this.sellerPortalService.respondToOffer(token, offerId, body.response);
  }

  // ── Authenticated endpoints (CRM agents) ─────────────────────────────────

  @Get('leads/:id/seller-portal')
  async getPortalInfo(@Param('id') leadId: string) {
    return this.sellerPortalService.getPortalInfo(leadId);
  }

  @Post('leads/:id/seller-portal')
  async createPortal(@Param('id') leadId: string) {
    const portal = await this.sellerPortalService.createPortal(leadId);
    return this.sellerPortalService.getPortalInfo(leadId);
  }

  @Post('leads/:id/seller-portal/send')
  async sendPortalLink(
    @Param('id') leadId: string,
    @Req() req: any,
  ) {
    // Get portal URL
    const portalUrl = await this.sellerPortalService.getPortalUrl(leadId);
    if (!portalUrl) throw new BadRequestException('No active portal for this lead');

    // Mark as sent
    await this.sellerPortalService.markPortalLinkSent(leadId);

    // Return the URL — the frontend will trigger the actual message send
    // through the existing messaging UI with the URL pre-filled
    return { success: true, portalUrl };
  }

  @Patch('leads/:id/seller-portal')
  async updatePortalStatus(
    @Param('id') leadId: string,
    @Body() body: { status: 'active' | 'disabled' },
  ) {
    if (!body.status || !['active', 'disabled'].includes(body.status)) {
      throw new BadRequestException('Status must be "active" or "disabled"');
    }
    return this.sellerPortalService.updatePortalStatus(leadId, body.status);
  }
}
