import { IsOptional, IsInt, IsBoolean, IsString, MaxLength, Min, Max } from 'class-validator';

export class UpdateComplianceDto {
  @IsOptional()
  @IsBoolean()
  optOutEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  optOutText?: string;

  @IsOptional()
  @IsBoolean()
  senderIdEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  senderIdText?: string;

  @IsOptional()
  @IsBoolean()
  periodicEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  periodicDays?: number;
}
