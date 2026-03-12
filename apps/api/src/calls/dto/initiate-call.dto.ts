import { IsString } from 'class-validator';

export class InitiateCallDto {
  @IsString()
  leadId: string;
}
