import { Body, Controller, Get, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { isFunctionId, type SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { AccessScopeService } from './common/access-scope.service';
import { CurrentUser } from './common/current-user';
import { attachmentContentDisposition } from './common/http';
import { PrismaService } from './common/prisma.service';
import { ProcessAccessService } from './common/process-access.service';
import { RunAuditDto } from './dto/audits.dto';
import { AuditsService } from './audits.service';

@Controller()
@UseGuards(AuthGuard)
export class AuditsController {
  constructor(
    private readonly auditsService: AuditsService,
    private readonly processAccess: ProcessAccessService,
    private readonly accessScope: AccessScopeService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('processes/:idOrCode/audit/run')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async run(@Param('idOrCode') idOrCode: string, @Body() body: RunAuditDto, @CurrentUser() user: SessionUser) {
    // Pre-flight scope check. The audits service still does its legacy
    // `findAccessibleProcessOrThrow(..., 'editor')` check, but that consults
    // only the base ProcessMember.permission — a function-viewer who is base
    // editor would slip through. Resolve the file's function and require
    // edit on that function scope before delegating.
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, idOrCode, 'viewer');
    const file = await this.prisma.workbookFile.findFirst({
      where: {
        processId: process.id,
        OR: [{ id: body.fileIdOrCode }, { displayCode: body.fileIdOrCode }],
      },
      select: { id: true, functionId: true },
    });
    if (!file) throw new NotFoundException(`File ${body.fileIdOrCode} not found`);
    if (isFunctionId(file.functionId)) {
      await this.accessScope.require(process.id, user, {
        kind: 'function',
        functionId: file.functionId,
        action: 'edit',
      });
    } else {
      await this.accessScope.require(process.id, user, { kind: 'all-functions', action: 'edit' });
    }
    return this.auditsService.run(idOrCode, body, user);
  }

  @Get('processes/:idOrCode/audit-runs')
  listForProcess(
    @Param('idOrCode') idOrCode: string,
    @Query('functionId') functionId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    return this.auditsService.listForProcess(idOrCode, functionId, user);
  }

  // Latest completed audit run for a file. The web client calls this when
  // the user lands on the Audit Results tab via a deep link (Escalation
  // Center "Open evidence", a bookmark, etc.) and there's no in-session
  // result cached. Mirrors the shape of GET audit-runs/:idOrCode.
  @Get('processes/:idOrCode/files/:fileIdOrCode/audit-runs/latest')
  latestForFile(
    @Param('idOrCode') idOrCode: string,
    @Param('fileIdOrCode') fileIdOrCode: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.auditsService.latestForFile(idOrCode, fileIdOrCode, user);
  }

  @Get('audit-runs/:idOrCode')
  get(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.auditsService.get(idOrCode, user);
  }

  @Get('audit-runs/:idOrCode/issues')
  issues(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.auditsService.issues(idOrCode, user);
  }

  @Get('audit-runs/:idOrCode/export')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async export(
    @Param('idOrCode') idOrCode: string,
    @Query('format') format: string | undefined,
    @Query('corrected') corrected: string | undefined,
    @CurrentUser() user: SessionUser,
    @Res() response: Response,
  ) {
    const file = await this.auditsService.buildExport(idOrCode, format || 'csv', user, corrected === '1' || corrected === 'true');
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', attachmentContentDisposition(file.fileName));
    response.send(file.content);
  }
}
