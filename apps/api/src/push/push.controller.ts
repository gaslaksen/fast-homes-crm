import {
  Body,
  Controller,
  Delete,
  Headers,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PushService } from './push.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

interface DecodedToken {
  userId?: string;
  organizationId?: string;
}

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /** Register (or refresh) the caller's device for push. Auth via JWT bearer. */
  @Post('devices')
  async register(
    @Body() dto: RegisterDeviceDto,
    @Headers('authorization') authHeader?: string,
  ) {
    const { userId, organizationId } = this.requireUser(authHeader);
    const device = await this.push.registerDevice(userId, organizationId, dto);
    return { id: device.id };
  }

  /** Unregister a device token on logout. */
  @Delete('devices/:token')
  async unregister(
    @Param('token') token: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const { userId } = this.requireUser(authHeader);
    return this.push.removeDevice(userId, token);
  }

  /** Send a test push to all of the caller's own devices (QA before the app exists). */
  @Post('test')
  async test(@Headers('authorization') authHeader?: string) {
    const { userId } = this.requireUser(authHeader);
    await this.push.notifyUsers([userId], {
      title: 'Dealcore',
      body: 'Test notification — push is working.',
      data: { type: 'test' },
    });
    return { sent: true, configured: this.push.isConfigured() };
  }

  private requireUser(authHeader?: string): DecodedToken & { userId: string } {
    try {
      const token = authHeader?.replace('Bearer ', '');
      const decoded = (token ? (jwt.decode(token) as DecodedToken) : null) || {};
      if (!decoded.userId) throw new UnauthorizedException('Missing user token');
      return decoded as DecodedToken & { userId: string };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid token');
    }
  }
}
