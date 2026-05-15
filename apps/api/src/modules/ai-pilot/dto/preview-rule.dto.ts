import { IsObject } from 'class-validator';

export class PreviewRuleDto {
  @IsObject()
  spec!: Record<string, unknown>;
}
