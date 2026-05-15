import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from '../../common/current-user';
import { DevLoginDto, LoginDto, SignupDto } from '../../dto/auth.dto';

// Auth endpoints get a tight per-IP throttle for anti-bot protection,
// but the e2e suite makes 100+ rapid signup/login calls from a single
// IP — so the limit is a Resolvable function that lifts the cap under
// NODE_ENV=test. Production keeps the real 10/min cap.
const AUTH_THROTTLE = {
  default: {
    limit: () => (process.env.NODE_ENV === 'test' ? 10_000 : 10),
    ttl: 60_000,
  },
};

@Controller('auth')
@SkipThrottle({ default: true })
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('signup')
  @SkipThrottle({ default: false })
  @Throttle(AUTH_THROTTLE)
  async signup(@Body() body: SignupDto, @Res({ passthrough: true }) response: Response) {
    return { user: await this.authService.signup(response, body) };
  }

  @Post('login')
  @SkipThrottle({ default: false })
  @Throttle(AUTH_THROTTLE)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) {
    return { user: await this.authService.login(response, body) };
  }

  @Post('dev-login')
  @SkipThrottle({ default: false })
  @Throttle(AUTH_THROTTLE)
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

  @Get('callback')
  callbackStub() {
    return { ok: false, message: 'OIDC callback is not configured in this environment.' };
  }
}
