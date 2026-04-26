import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { isFunctionId } from '@ses/domain';
import type { FunctionId, SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth.guard';
import { CurrentUser } from '../common/current-user';
import { AdminGuard } from '../common/admin.guard';
import { AiPilotService } from './ai-pilot.service';
import { GenerateRuleDto } from './dto/generate-rule.dto';
import { PreviewRuleDto } from './dto/preview-rule.dto';
import { SaveRuleDto } from './dto/save-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { PickSheetDto } from './dto/pick-sheet.dto';
import { EnhancePromptDto } from './dto/enhance-prompt.dto';

const MAX_SAMPLE_BYTES = 5 * 1024 * 1024;

function requireFunctionId(raw: string): FunctionId {
  if (!isFunctionId(raw)) throw new BadRequestException(`Unknown function ${raw}`);
  return raw;
}

@Controller('admin/ai-pilot')
@UseGuards(AuthGuard, AdminGuard)
export class AiPilotController {
  constructor(private readonly service: AiPilotService) {}

  @Get('health')
  health() {
    return this.service.health();
  }

  @Get('functions/:functionId/prompt-examples')
  promptExamples(@Param('functionId') functionId: string) {
    return { examples: this.service.getPromptExamples(requireFunctionId(functionId)) };
  }

  @Get('functions/:functionId/rules')
  listForFunction(@Param('functionId') functionId: string) {
    return this.service.listRulesForFunction(requireFunctionId(functionId));
  }

  @Get('rules/:ruleCode')
  getRule(@Param('ruleCode') ruleCode: string) {
    return this.service.getRule(ruleCode);
  }

  // ---------- Sandbox ----------

  @Post('sandbox/upload')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SAMPLE_BYTES },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body('functionId') functionId: string,
    @CurrentUser() user: SessionUser,
  ) {
    if (!file) throw new BadRequestException('file required');
    return this.service.uploadSample(user, requireFunctionId(functionId), file);
  }

  @Post('sandbox/:sessionId/sheet')
  pickSheet(
    @Param('sessionId') sessionId: string,
    @Body() body: PickSheetDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.service.pickSheet(user, sessionId, body.sheetName);
  }

  @Post('sandbox/:sessionId/generate')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  generate(
    @Param('sessionId') sessionId: string,
    @Body() body: GenerateRuleDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.service.generate(user, sessionId, body.prompt);
  }

  @Post('sandbox/:sessionId/enhance-prompt')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  enhancePrompt(
    @Param('sessionId') sessionId: string,
    @Body() body: EnhancePromptDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.service.enhancePrompt(user, sessionId, body.prompt, body.columns);
  }

  @Post('sandbox/:sessionId/preview')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  preview(
    @Param('sessionId') sessionId: string,
    @Body() body: PreviewRuleDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.service.preview(user, sessionId, body.spec);
  }

  @Post('sandbox/:sessionId/preview-escalations')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  previewEscalations(
    @Param('sessionId') sessionId: string,
    @Body() body: PreviewRuleDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.service.previewEscalations(user, sessionId, body.spec);
  }

  @Post('rules')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  save(@Body() body: SaveRuleDto, @CurrentUser() user: SessionUser) {
    return this.service.saveRule(user, body.spec, body.sandboxSessionId, body.previewedAt);
  }

  @Patch('rules/:ruleCode')
  update(
    @Param('ruleCode') ruleCode: string,
    @Body() body: UpdateRuleDto,
    @CurrentUser() user: SessionUser,
  ) {
    if (body.status) return this.service.setStatus(user, ruleCode, body.status);
    throw new BadRequestException('Only status updates are supported in v1');
  }

  @Post('rules/:ruleCode/pause')
  pause(@Param('ruleCode') ruleCode: string, @CurrentUser() user: SessionUser) {
    return this.service.setStatus(user, ruleCode, 'paused');
  }

  @Post('rules/:ruleCode/resume')
  resume(@Param('ruleCode') ruleCode: string, @CurrentUser() user: SessionUser) {
    return this.service.setStatus(user, ruleCode, 'active');
  }

  @Post('rules/:ruleCode/archive')
  archive(@Param('ruleCode') ruleCode: string, @CurrentUser() user: SessionUser) {
    return this.service.setStatus(user, ruleCode, 'archived');
  }

  // ---------- Audit log ----------

  @Get('audit-log')
  auditLog(
    @Query('ruleCode') ruleCode: string | undefined,
    @Query('actorId') actorId: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const lim = limit ? Number.parseInt(limit, 10) : undefined;
    return this.service.listAuditLog({
      ruleCode: ruleCode || undefined,
      actorId: actorId || undefined,
      limit: Number.isFinite(lim) ? lim : undefined,
    });
  }

  // ---------- Welcome state ----------
  // Kept admin-gated: only admins ever see the modal.

  @Get('welcome-state')
  welcomeState(@CurrentUser() user: SessionUser) {
    return this.service.getWelcomeState(user);
  }

  @Post('welcome-state/dismiss')
  dismissWelcome(@CurrentUser() user: SessionUser) {
    return this.service.dismissWelcome(user);
  }

  // Convenience: also allow DELETE on rules to mean archive.
  @Delete('rules/:ruleCode')
  delete(@Param('ruleCode') ruleCode: string, @CurrentUser() user: SessionUser) {
    return this.service.setStatus(user, ruleCode, 'archived');
  }
}
