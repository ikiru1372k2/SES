import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { DevLoginDto } from './dto/auth.dto';

@Controller('auth')
@SkipThrottle({ default: true })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('dev-login')
  @SkipThrottle({ default: false })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async devLogin(@Body() body: DevLoginDto, @Res({ passthrough: true }) response: Response) {
    const identifier = body.identifier ?? body.email ?? body.displayCode;
    if (identifier === undefined || identifier === null || String(identifier).trim() === '') {
      throw new BadRequestException('identifier, email, or displayCode is required');
    }
    return { user: await this.authService.devLogin(response, String(identifier).trim()) };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    this.authService.logout(response);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: unknown) {
    return { user };
  }

  @Post('login')
  loginStub() {
    return { ok: false, message: 'OIDC login is not configured in this environment. Use /auth/dev-login for Phase 1.' };
  }

  @Get('callback')
  callbackStub() {
    return { ok: false, message: 'OIDC callback is not configured in this environment.' };
  }
}
