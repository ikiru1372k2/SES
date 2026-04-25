import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export type ScopeAccessLevel = 'viewer' | 'editor';
export type ScopeType = 'all-functions' | 'function' | 'escalation-center';
export type AccessMode = 'unrestricted' | 'scoped';

export class ScopeEntryDto {
  @IsIn(['all-functions', 'function', 'escalation-center'])
  scopeType!: ScopeType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  functionId?: string;

  @IsIn(['viewer', 'editor'])
  accessLevel!: ScopeAccessLevel;
}

export class AddProcessMemberDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userCode?: string;

  @IsOptional()
  @IsIn(['viewer', 'editor', 'owner'])
  permission?: 'viewer' | 'editor' | 'owner';

  @IsOptional()
  @IsIn(['unrestricted', 'scoped'])
  accessMode?: AccessMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => ScopeEntryDto)
  scopes?: ScopeEntryDto[];
}

export class UpdateProcessMemberDto {
  @IsOptional()
  @IsIn(['viewer', 'editor', 'owner'])
  permission?: 'viewer' | 'editor' | 'owner';

  @IsOptional()
  @IsIn(['unrestricted', 'scoped'])
  accessMode?: AccessMode;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => ScopeEntryDto)
  scopes?: ScopeEntryDto[];
}
