import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth.guard';
import { CurrentUser } from '../common/current-user';
import { ProcessAccessService } from '../common/process-access.service';
import { SignedLinkService } from './signed-link.service';

class CreateSignedLinkDto {
  @IsEmail()
  managerEmail!: string;

  @IsOptional()
  @IsString()
  managerName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  flaggedProjectCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  expiresInDays?: number;
}

@Controller('processes')
@UseGuards(AuthGuard)
export class SignedLinkController {
  constructor(
    private readonly signedLinks: SignedLinkService,
    private readonly processAccess: ProcessAccessService,
  ) {}

  @Post(':idOrCode/signed-links')
  async create(
    @Param('idOrCode') idOrCode: string,
    @Body() body: CreateSignedLinkDto,
    @CurrentUser() user: SessionUser,
  ) {
    const proc = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'editor');
    const ttlSeconds = (body.expiresInDays ?? 7) * 24 * 60 * 60;
    const issued = await this.signedLinks.issue({
      processCode: proc.displayCode,
      managerEmail: body.managerEmail,
      allowedActions: ['acknowledge', 'correct', 'dispute'],
      ttlSeconds,
      createdByUserId: user.id,
    });
    const baseUrl = process.env.SES_BASE_URL ?? 'http://localhost:3210';
    return {
      token: issued.token,
      url: SignedLinkService.buildUrl(baseUrl, issued.token),
      expiresAt: issued.expiresAt.toISOString(),
      linkCode: issued.linkCode,
    };
  }
}
