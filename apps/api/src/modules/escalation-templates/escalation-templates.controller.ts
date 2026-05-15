import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/current-user';
import { EscalationTemplatesService } from './escalation-templates.service';

@Controller()
@UseGuards(AuthGuard)
export class EscalationTemplatesController {
  constructor(private readonly escalationTemplates: EscalationTemplatesService) {}

  @Get('escalation-templates')
  listMerged(
    @Query('stageKey') stageKey: string | undefined,
    @Query('includeInactive') includeInactive: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    return this.escalationTemplates.listMerged(user, stageKey, includeInactive === '1' || includeInactive === 'true');
  }

  @Get('escalation-templates/versions')
  listVersions(@Query('stageKey') stageKey: string, @CurrentUser() user: SessionUser) {
    return this.escalationTemplates.listAllVersions(user, stageKey);
  }

  @Post('escalation-templates')
  create(
    @Body()
    body: {
      stage?: string;
      subject?: string;
      body?: string;
      channel?: string;
      parentId?: string | null;
    },
    @CurrentUser() user: SessionUser,
  ) {
    return this.escalationTemplates.createOverride(body, user);
  }

  @Patch('escalation-templates/:id')
  patch(
    @Param('id') id: string,
    @Body() body: { subject?: string; body?: string; channel?: string; active?: boolean },
    @CurrentUser() user: SessionUser,
  ) {
    return this.escalationTemplates.publishPatch(id, body, user);
  }
}
