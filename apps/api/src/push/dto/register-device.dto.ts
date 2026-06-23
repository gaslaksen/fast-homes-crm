import { IsOptional, IsString } from 'class-validator';

/**
 * Body for POST /push/devices. A device sends whichever tokens it has:
 * apnsToken for alert pushes, voipToken for Twilio VoIP/incoming-call pushes.
 * At least one is required (validated in the service).
 *
 * The fields are decorated because the global ValidationPipe runs with
 * whitelist + forbidNonWhitelisted, which rejects any undecorated property.
 */
export class RegisterDeviceDto {
  @IsOptional()
  @IsString()
  platform?: string; // ios | android (android reserved for later)

  @IsOptional()
  @IsString()
  apnsToken?: string;

  @IsOptional()
  @IsString()
  voipToken?: string;

  @IsOptional()
  @IsString()
  appVersion?: string;

  @IsOptional()
  @IsString()
  deviceName?: string;
}
