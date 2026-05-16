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

  // Public signup is always provisioned as `auditor` (audit U-04 / G-2).
  // The field is accepted for backward compatibility but ignored — the
  // service hard-codes the role server-side. Admin promotion is a separate
  // admin-only operation.
  @IsOptional()
  @IsIn(['admin', 'auditor'])
  role?: 'admin' | 'auditor';
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
