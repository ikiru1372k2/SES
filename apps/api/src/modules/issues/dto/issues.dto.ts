import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AddIssueCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  body!: string;
}

export class SaveCorrectionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  effort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  projectState?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  projectManager?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  note?: string;
}

export class SaveAcknowledgmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  status!: string;
}
