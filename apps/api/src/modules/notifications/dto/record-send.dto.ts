import { IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class RecordSendDto {
  @IsEmail()
  managerEmail!: string;

  @IsOptional()
  @IsString()
  managerName?: string;

  @IsIn(['outlook', 'teams', 'eml'])
  channel!: 'outlook' | 'teams' | 'eml';

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  subject!: string;

  @IsString()
  @MaxLength(2000)
  bodyPreview!: string;

  @IsInt()
  @Min(0)
  issueCount!: number;

  @IsOptional()
  @IsIn(['High', 'Medium', 'Low'])
  severity?: 'High' | 'Medium' | 'Low';
}
