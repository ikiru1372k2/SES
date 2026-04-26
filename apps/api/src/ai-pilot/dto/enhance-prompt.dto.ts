import { IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class EnhancePromptDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  prompt!: string;

  @IsArray()
  @IsString({ each: true })
  columns!: string[];
}
