import { Controller, Get, Header, Headers, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { DigestService } from './digest.service';
import { DigestRenderService } from './digest-render.service';

/**
 * Preview and test-send endpoints for the Daily Brief.
 *
 * `send-test` deliberately takes no recipient. It always sends to the address
 * on the authenticated user's own record, so the endpoint cannot be used to mail
 * anyone else even with a valid token.
 */
@Controller('digest')
export class DigestController {
  private readonly logger = new Logger(DigestController.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private digest: DigestService,
    private render: DigestRenderService,
    private mailer: MailerService,
  ) {}

  /** Verified (not merely decoded) - this controller can send mail. */
  private requireUser(authHeader?: string): { userId: string; organizationId?: string } {
    const token = authHeader?.replace('Bearer ', '');
    if (!token) throw new UnauthorizedException('No token');
    try {
      return jwt.verify(token, this.config.get('JWT_SECRET') || 'dev-secret-key') as any;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private async loadUser(authHeader?: string) {
    const decoded = this.requireUser(authHeader);
    const user = await this.prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, firstName: true, organizationId: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }

  /** The assembled brief as JSON. Useful for eyeballing the data before styling. */
  @Get('preview')
  async preview(@Headers('authorization') authHeader?: string) {
    const user = await this.loadUser(authHeader);
    return this.digest.build({
      organizationId: user.organizationId,
      greetingName: user.firstName,
    });
  }

  /** The rendered email, for opening in a browser or piping to a file. */
  @Get('preview.html')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async previewHtml(@Headers('authorization') authHeader?: string) {
    const user = await this.loadUser(authHeader);
    const brief = await this.digest.build({
      organizationId: user.organizationId,
      greetingName: user.firstName,
    });
    return this.render.renderHtml(brief);
  }

  /**
   * Who the 7:00 AM cron will actually mail. Worth checking before the first
   * automatic run, since a silently-missing teammate is invisible otherwise.
   */
  @Get('recipients')
  async recipients(@Headers('authorization') authHeader?: string) {
    const user = await this.loadUser(authHeader);
    const rows = await this.prisma.user.findMany({
      where: { organizationId: user.organizationId, digestEnabled: true },
      select: { email: true, firstName: true, lastName: true, role: true },
      orderBy: { firstName: 'asc' },
    });
    const optedOut = await this.prisma.user.findMany({
      where: { organizationId: user.organizationId, digestEnabled: false },
      select: { email: true },
    });
    return {
      schedule: '07:00 America/New_York, daily',
      willReceive: rows,
      optedOut: optedOut.map((u) => u.email),
    };
  }

  /** Send today's brief to the caller's own address. */
  @Post('send-test')
  async sendTest(@Headers('authorization') authHeader?: string) {
    const user = await this.loadUser(authHeader);
    const brief = await this.digest.build({
      organizationId: user.organizationId,
      greetingName: user.firstName,
    });

    const { mailgunId } = await this.mailer.sendInternalHtml({
      to: user.email,
      subject: brief.subject,
      html: this.render.renderHtml(brief),
      text: this.render.renderText(brief),
      tags: ['daily-digest', 'digest-test'],
    });

    this.logger.log(`Daily Brief test sent to ${user.email} (mailgun ${mailgunId})`);

    return {
      sent: true,
      to: user.email,
      subject: brief.subject,
      mailgunId,
      isEmpty: brief.isEmpty,
      sections: {
        bigThing: !!brief.bigThing,
        actions: brief.actions.length,
        waiting: brief.waiting.length,
        dealsInMotion: brief.dealsInMotion.length,
        foreclosures: brief.foreclosures.length,
        newOvernight: brief.newOvernight.length,
        yesterday: brief.yesterday.length,
      },
    };
  }
}
