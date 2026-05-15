import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class MappingSourceDto {
  @IsIn(['master_data_version', 'uploaded_file', 'none'])
  type!: 'master_data_version' | 'uploaded_file' | 'none';

  @IsString()
  @ValidateIf((o: MappingSourceDto) => o.type === 'master_data_version')
  masterDataVersionId?: string;

  @IsString()
  @ValidateIf((o: MappingSourceDto) => o.type === 'uploaded_file')
  uploadId?: string;

  /** When false: issues without email are still created; unresolved names surfaced in run summary. Default true. */
  @IsBoolean()
  @IsOptional()
  allowUnresolvedFallback?: boolean;
}

export class RunAuditDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  fileIdOrCode!: string;

  @ValidateNested()
  @Type(() => MappingSourceDto)
  @IsOptional()
  mappingSource?: MappingSourceDto;
}

