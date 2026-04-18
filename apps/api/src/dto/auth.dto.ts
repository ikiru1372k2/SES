import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DevLoginDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(320)
  identifier?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  displayCode?: string;
}
