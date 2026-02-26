import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsObject,
  IsArray,
  Min,
} from 'class-validator';

export class CreateAiPromptDto {
  @IsString()
  name: string;

  @IsString()
  scenario: string;

  @IsObject()
  contextRules: Record<string, any>;

  @IsString()
  systemPrompt: string;

  @IsOptional()
  @IsArray()
  exampleMessages?: any[];

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAiPromptDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  scenario?: string;

  @IsOptional()
  @IsObject()
  contextRules?: Record<string, any>;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsArray()
  exampleMessages?: any[];

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
