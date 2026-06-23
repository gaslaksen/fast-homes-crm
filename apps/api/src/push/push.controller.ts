import {
  Body,
  Controller,
  Delete,
  Headers,
  Logger,
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
  private readonly logger = new Logger(PushController.name);

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
    const configured = this.push.isConfigured();
    const devices = await this.push.countDevices(userId);
    this.logger.log(
      `Test push: user=${userId} configured=${configured} registeredDevices=${devices}`,
    );
    await this.push.notifyUsers([userId], {
      title: 'Dealcore',
      body: 'Test notification — push is working.',
      data: { type: 'test' },
    });
    return { sent: configured && devices > 0, configured, devices };
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
