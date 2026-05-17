import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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

/**
 * Pin a chart from a chat answer into the user's process workbench. The
 * chartSpec is the verbatim ChartSpec the chat rendered (stored as jsonb so
 * the workbench re-renders without re-querying the LLM).
 */
export class PinChartDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  question?: string;

  @IsOptional()
  @IsString()
  functionId?: string;

  // ChartSpec shape is validated downstream by the renderer; here we only
  // require it to be present so we never persist an empty pin.
  @IsDefined()
  chartSpec!: unknown;
}

export class ReorderPinnedChartsDto {
  @IsArray()
  @IsString({ each: true })
  orderedIds!: string[];
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
