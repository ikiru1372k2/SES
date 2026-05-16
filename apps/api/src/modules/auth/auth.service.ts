import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { SessionUser } from '@ses/domain';
import { createId, tenantManagerDirectoryEnabled } from '@ses/domain';
import { DEFAULT_TENANT_ID } from '../../common/default-tenant';
import { PrismaService } from '../../common/prisma.service';
import { requestContext } from '../../common/request-context';
import type { LoginDto, SignupDto } from './dto/auth.dto';

type TokenPayload = {
  sub: string;
  displayCode: string;
  email: string;
  displayName: string;
  role: 'admin' | 'auditor' | 'viewer';
};

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const secret = process.env.SES_AUTH_SECRET;
    // Refuse startup if a secret IS provided but is too short (wrong in any env).
    // No secret = dev fallback; non-production dev is allowed to omit it entirely.
    if (secret !== undefined && secret.length < 32) {
      throw new InternalServerErrorException(
        'SES_AUTH_SECRET is set but shorter than 32 characters. Use a cryptographically random string.',
      );
    }
    if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
      throw new InternalServerErrorException(
        'SES_AUTH_SECRET must be a cryptographically random string of at least 32 characters in production.',
      );
    }
    // F14: dev-login is a passwordless login-by-identifier. It should never
    // be on in production; if an operator deliberately enabled the demo
    // escape hatch, make that loudly visible in the logs.
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.SES_ALLOW_DEV_LOGIN === 'true' &&
      process.env.SES_ALLOW_DEMO_DEV_LOGIN === 'true'
    ) {
      new Logger(AuthService.name).warn(
        'SECURITY: passwordless dev-login is ENABLED in production ' +
          '(SES_ALLOW_DEV_LOGIN=true, SES_ALLOW_DEMO_DEV_LOGIN=true). ' +
          'Disable both unless this is an intentional, time-boxed demo.',
      );
    }
  }

  private secret(): string {
    const value = process.env.SES_AUTH_SECRET;
    if (process.env.NODE_ENV === 'production') {
      if (!value || value.length < 32) {
        throw new UnauthorizedException('Server authentication is misconfigured');
      }
      return value;
    }
    return value || 'ses-dev-secret';
  }

  private async resolveSessionTenantContext(
    userId: string,
  ): Promise<{ tenantId: string; tenantDisplayCode: string; managerDirectoryEnabled: boolean }> {
    const member = await this.prisma.processMember.findFirst({
      where: { userId },
      orderBy: { addedAt: 'asc' },
      include: { process: { include: { tenant: true } } },
    });
    if (member?.process?.tenant) {
      const t = member.process.tenant;
      return {
        tenantId: t.id,
        tenantDisplayCode: t.name,
        managerDirectoryEnabled: tenantManagerDirectoryEnabled(t.settings),
      };
    }
    // Fallback to the default tenant for any role without a process membership.
    // Per-process authorization is enforced separately by processMember lookups,
    // so this fallback only governs initial tenant binding for fresh accounts.
    const t = await this.prisma.tenant.findUnique({ where: { id: DEFAULT_TENANT_ID } });
    if (!t) {
      throw new InternalServerErrorException('Default tenant is not provisioned');
    }
    return {
      tenantId: t.id,
      tenantDisplayCode: t.name,
      managerDirectoryEnabled: tenantManagerDirectoryEnabled(t.settings),
    };
  }

  private async buildSessionUser(user: {
    id: string;
    displayCode: string;
    email: string;
    displayName: string;
    role: string;
  }): Promise<SessionUser> {
    const role = (user.role as SessionUser['role']) || 'auditor';
    const ctx = await this.resolveSessionTenantContext(user.id);
    return {
      id: user.id,
      displayCode: user.displayCode,
      email: user.email,
      displayName: user.displayName,
      role,
      tenantId: ctx.tenantId,
      tenantDisplayCode: ctx.tenantDisplayCode,
      managerDirectoryEnabled: ctx.managerDirectoryEnabled,
    };
  }

  private sign(payload: TokenPayload): string {
    return jwt.sign(payload, this.secret(), { expiresIn: '7d', algorithm: 'HS256' });
  }

  private cookieSameSite(): 'strict' | 'lax' | 'none' {
    const raw = (process.env.SES_COOKIE_SAMESITE || 'lax').toLowerCase();
    if (raw === 'strict' || raw === 'lax' || raw === 'none') {
      return raw;
    }
    return 'lax';
  }

  private cookieSecure(): boolean {
    const raw = process.env.SES_COOKIE_SECURE?.toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return process.env.NODE_ENV === 'production';
  }

  private requireJwtString(value: unknown, maxLen: number, field: string): string {
    if (typeof value !== 'string' || value.length < 1 || value.length > maxLen) {
      throw new UnauthorizedException(`Invalid token payload: ${field}`);
    }
    return value;
  }

  private normalizeTokenPayload(raw: JwtPayload): TokenPayload {
    const sub = this.requireJwtString(raw.sub, 128, 'sub');
    const displayCode = this.requireJwtString((raw as Record<string, unknown>).displayCode, 64, 'displayCode');
    const email = this.requireJwtString((raw as Record<string, unknown>).email, 320, 'email');
    const displayName = this.requireJwtString((raw as Record<string, unknown>).displayName, 200, 'displayName');
    const roleRaw = (raw as Record<string, unknown>).role;
    const role =
      roleRaw === 'admin' || roleRaw === 'auditor' || roleRaw === 'viewer' ? roleRaw : null;
    if (!role) {
      throw new UnauthorizedException('Invalid token payload: role');
    }
    return { sub, displayCode, email, displayName, role };
  }

  private verify(token: string): TokenPayload {
    try {
      const decoded = jwt.verify(token, this.secret(), { algorithms: ['HS256'] });
      if (typeof decoded === 'string') {
        throw new UnauthorizedException('Invalid auth token');
      }
      return this.normalizeTokenPayload(decoded as JwtPayload);
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException('Invalid or expired auth token');
    }
  }

  private setCookie(response: Response, token: string): void {
    response.cookie('ses_auth', token, {
      httpOnly: true,
      sameSite: this.cookieSameSite(),
      secure: this.cookieSecure(),
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  private devLoginEnabled(): boolean {
    if (process.env.SES_ALLOW_DEV_LOGIN !== 'true') {
      return false;
    }
    if (process.env.NODE_ENV !== 'production') {
      return true;
    }
    return process.env.SES_ALLOW_DEMO_DEV_LOGIN === 'true';
  }

  async devLogin(response: Response, identifier: string): Promise<SessionUser> {
    // Production keeps this off by default; demos must opt in explicitly.
    if (!this.devLoginEnabled()) {
      throw new ForbiddenException('Dev login is disabled in this environment');
    }
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: identifier }, { displayCode: identifier }, { email: identifier }],
        isActive: true,
      },
    });
    if (!user) throw new UnauthorizedException('Unknown dev user');
    const payload: TokenPayload = {
      sub: user.id,
      displayCode: user.displayCode,
      email: user.email,
      displayName: user.displayName,
      role: (user.role as TokenPayload['role']) || 'auditor',
    };
    const token = this.sign(payload);
    this.setCookie(response, token);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    requestContext.setUser({ userId: user.id, userCode: user.displayCode, userEmail: user.email });
    return await this.buildSessionUser(user);
  }

  async signup(response: Response, payload: SignupDto): Promise<SessionUser> {
    const email = payload.email.trim().toLowerCase();
    // Defence in depth (audit U-04 / gap G-2): the public signup endpoint
    // always provisions an auditor, regardless of any `role` sent by the
    // client. Admin promotion is an admin-only Directory operation and never
    // happens through this unauthenticated route.
    const role: 'auditor' = 'auditor';
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const passwordHash = await bcrypt.hash(payload.password, 10);
    const id = createId();
    const displayCode = `USR-${createId().slice(-8).toUpperCase()}`;
    const user = await this.prisma.user.create({
      data: {
        id,
        displayCode,
        email,
        displayName: payload.displayName.trim(),
        role,
        passwordHash,
        isActive: true,
        lastLoginAt: new Date(),
      },
    });
    const token = this.sign({
      sub: user.id,
      displayCode: user.displayCode,
      email: user.email,
      displayName: user.displayName,
      role: (user.role as TokenPayload['role']) || 'auditor',
    });
    this.setCookie(response, token);
    requestContext.setUser({ userId: user.id, userCode: user.displayCode, userEmail: user.email });
    return await this.buildSessionUser(user);
  }

  async login(response: Response, payload: LoginDto): Promise<SessionUser> {
    const email = payload.email.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: { email, isActive: true },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.passwordHash) {
      throw new UnauthorizedException('Password login not enabled for this account');
    }
    const ok = await bcrypt.compare(payload.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const token = this.sign({
      sub: user.id,
      displayCode: user.displayCode,
      email: user.email,
      displayName: user.displayName,
      role: (user.role as TokenPayload['role']) || 'auditor',
    });
    this.setCookie(response, token);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    requestContext.setUser({ userId: user.id, userCode: user.displayCode, userEmail: user.email });
    return await this.buildSessionUser(user);
  }

  async authenticateRequest(request: Request): Promise<SessionUser> {
    const authorization = request.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const token = bearer || request.cookies?.ses_auth;
    if (!token) throw new UnauthorizedException('Missing auth token');
    const payload = this.verify(token);
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, isActive: true },
    });
    if (!user) throw new UnauthorizedException('User is inactive');
    requestContext.setUser({ userId: user.id, userCode: user.displayCode, userEmail: user.email });
    return await this.buildSessionUser(user);
  }

  async currentUser(request: Request): Promise<SessionUser> {
    return this.authenticateRequest(request);
  }

  logout(response: Response): void {
    response.clearCookie('ses_auth', {
      path: '/',
      secure: this.cookieSecure(),
      sameSite: this.cookieSameSite(),
    });
  }
}
