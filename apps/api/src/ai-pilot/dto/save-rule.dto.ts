import { IsDateString, IsObject, IsString } from 'class-validator';

export class SaveRuleDto {
  @IsObject()
  spec!: Record<string, unknown>;

  @IsString()
  sandboxSessionId!: string;

  @IsDateString()
  previewedAt!: string;
}
