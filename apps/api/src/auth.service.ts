import { ForbiddenException, Inject, Injectable, InternalServerErrorException, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { SessionUser } from '@ses/domain';
import { PrismaService } from './common/prisma.service';
import { requestContext } from './common/request-context';

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

  private serializeUser(payload: TokenPayload): SessionUser {
    return {
      id: payload.sub,
      displayCode: payload.displayCode,
      email: payload.email,
      displayName: payload.displayName,
      role: payload.role,
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
    return this.serializeUser(payload);
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
    return {
      id: user.id,
      displayCode: user.displayCode,
      email: user.email,
      displayName: user.displayName,
      role: (user.role as SessionUser['role']) || 'auditor',
    };
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
