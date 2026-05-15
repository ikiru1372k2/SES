import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  flagMessage?: string;

  @IsOptional()
  @IsObject()
  logic?: Record<string, unknown>;

  @IsOptional()
  @IsIn(['High', 'Medium', 'Low'])
  severity?: 'High' | 'Medium' | 'Low';

  @IsOptional()
  @IsIn(['active', 'paused', 'archived'])
  status?: 'active' | 'paused' | 'archived';
}
