import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateVersionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  auditRunIdOrCode?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  versionName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  notes?: string;
}
