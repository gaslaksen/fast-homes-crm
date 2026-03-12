import { IsOptional, IsInt, IsBoolean, Min, Max } from 'class-validator';

export class UpdateDripDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  initialDelayMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  nextQuestionDelayMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  retryDelayMs?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;

  @IsOptional()
  @IsBoolean()
  demoMode?: boolean;

  @IsOptional()
  @IsBoolean()
  aiSmsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  aiCallEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  callDelayMs?: number;
}
