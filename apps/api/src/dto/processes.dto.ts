import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
