import { IsString, MaxLength, MinLength } from 'class-validator';

export class RunAuditDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  fileIdOrCode!: string;
}
