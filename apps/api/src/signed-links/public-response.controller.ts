import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { PublicResponseService, type PublicSubmitInput } from './public-response.service';

/**
 * Public (unauthenticated) endpoints for manager responses.
 *
 * This controller is intentionally NOT @UseGuards(AuthGuard) — the entire
 * point is that managers can respond without logging in. Auth is replaced by
 * HMAC token verification: only someone holding a valid, unexpired, unused
 * token can do anything here.
 *
 * Throttled aggressively to make brute-forcing signatures impractical; a real
 * token has 256 bits of HMAC entropy so the throttle is mostly belt-and-braces.
 */
@Controller('public/respond')
export class PublicResponseController {
  constructor(private readonly publicResponse: PublicResponseService) {}

  @SkipThrottle({ default: true }) // page loads are cheap reads
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @Get(':token')
  async view(@Param('token') token: string) {
    if (!token || token.length > 4096) {
      throw new BadRequestException('Invalid response link');
    }
    return this.publicResponse.view(token);
  }

  // Stricter rate limit on submit; still plenty for legitimate use.
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post(':token')
  async submit(
    @Param('token') token: string,
    @Body() body: PublicSubmitInput,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    if (!token || token.length > 4096) {
      throw new BadRequestException('Invalid response link');
    }
    if (!body?.action) {
      throw new BadRequestException('Missing action');
    }
    // Clamp note length defensively — the DB field is TEXT but we don't
    // want a 10MB essay dropped into our activity log.
    const clean: PublicSubmitInput = {
      action: body.action,
      note: body.note?.slice(0, 2000),
      correctedEffort:
        typeof body.correctedEffort === 'number' && Number.isFinite(body.correctedEffort)
          ? body.correctedEffort
          : undefined,
      correctedState: body.correctedState?.slice(0, 100),
      correctedManager: body.correctedManager?.slice(0, 200),
    };
    return this.publicResponse.submit(token, clean, { ip, userAgent });
  }
}
