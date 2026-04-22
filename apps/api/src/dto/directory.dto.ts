import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class DirectoryRowInputDto {
  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsString()
  @MinLength(3)
  email!: string;
}

export class DirectoryUploadDto {
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DirectoryRowInputDto)
  rows!: DirectoryRowInputDto[];
}

export class DirectoryCommitDto {
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @IsIn(['skip_duplicates', 'update_existing'])
  strategy!: 'skip_duplicates' | 'update_existing';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DirectoryRowInputDto)
  rows!: DirectoryRowInputDto[];
}

export class DirectoryResolveDto {
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @IsString()
  @MinLength(1)
  observedName!: string;

  @IsString()
  @MinLength(1)
  directoryId!: string;
}

export class DirectoryResolveBatchItemDto {
  @IsString()
  @MinLength(1)
  observedName!: string;

  @IsString()
  @MinLength(1)
  directoryId!: string;
}

export class DirectoryResolveBatchDto {
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DirectoryResolveBatchItemDto)
  items!: DirectoryResolveBatchItemDto[];
}

export class DirectoryMergeDto {
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @IsString()
  @MinLength(1)
  sourceId!: string;

  @IsString()
  @MinLength(1)
  targetId!: string;
}

export class DirectoryListQueryDto {
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['active', 'archived', 'all'])
  filter?: 'active' | 'archived' | 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class DirectorySuggestionsDto {
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  names!: string[];
}

export class DirectoryCreateEntryDto {
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @IsString()
  @MinLength(1)
  firstName!: string;

  @IsString()
  @MinLength(1)
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsIn(['manual', 'upload', 'inline-resolved'])
  source!: 'manual' | 'upload' | 'inline-resolved';

  @IsOptional()
  @IsString()
  @MinLength(1)
  mapObservedName?: string;
}

export class DirectoryPatchEntryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  confirmEmailRepoint?: boolean;
}

export class DirectoryArchiveBulkDto {
  @IsString()
  @MinLength(1)
  tenantId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}
