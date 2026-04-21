import { IsBoolean, IsDateString, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProcessDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @IsDateString()
  nextAuditDue?: string | null;
}

export class UpdateProcessDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @IsDateString()
  nextAuditDue?: string | null;
}

export class UpdateSheetSelectionDto {
  @IsOptional()
  @IsBoolean()
  isSelected?: boolean;
}

export class CreateFunctionAuditRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  proposedName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  description?: string;

  @IsEmail()
  @MaxLength(320)
  contactEmail!: string;
}
