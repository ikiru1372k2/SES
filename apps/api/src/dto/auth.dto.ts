import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

export class SignupDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  displayName!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @IsIn(['admin', 'auditor'])
  role!: 'admin' | 'auditor';
}

export class LoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
