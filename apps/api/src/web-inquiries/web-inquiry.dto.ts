import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body of the public call-back form. The global ValidationPipe rejects any
 * property not listed here, so the honeypot field has to be declared too.
 */
export class CreateWebInquiryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsBoolean()
  smsMarketingConsent: boolean;

  @IsBoolean()
  smsServiceConsent: boolean;

  @IsString()
  @MaxLength(40)
  consentVersion: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  pageUrl?: string;

  /** Honeypot. Hidden from people, so anything in it means a bot. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
