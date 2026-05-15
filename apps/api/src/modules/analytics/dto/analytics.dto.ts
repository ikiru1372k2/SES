import { IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ChatAnalyticsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question!: string;

  @IsOptional()
  @IsString()
  functionId?: string;

  @IsOptional()
  @IsString()
  versionRef?: string;

  @IsOptional()
  @IsString()
  compareTo?: string;

  @IsOptional()
  @IsBoolean()
  useStub?: boolean;
}

export class ChatHistoryQueryDto {
  @IsOptional()
  @IsString()
  functionId?: string;
}

export class AnomaliesQueryDto {
  @IsOptional()
  @IsString()
  functionId?: string;

  @IsOptional()
  @IsString()
  versionRef?: string;
}

export class ExportDto {
  @IsString()
  format!: 'pdf' | 'xlsx';

  @IsOptional()
  @IsString()
  functionId?: string;

  @IsOptional()
  @IsArray()
  chartSpecs?: unknown[];
}
