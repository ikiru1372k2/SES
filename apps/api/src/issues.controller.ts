import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import { isFunctionId, type SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { AccessScopeService } from './common/access-scope.service';
import { CurrentUser } from './common/current-user';
import { PrismaService } from './common/prisma.service';
import { ProcessAccessService } from './common/process-access.service';
import { AddIssueCommentDto, SaveAcknowledgmentDto, SaveCorrectionDto } from './dto/issues.dto';
import { IssuesService } from './issues.service';

@Controller()
@UseGuards(AuthGuard)
export class IssuesController {
  constructor(
    private readonly issuesService: IssuesService,
    private readonly processAccess: ProcessAccessService,
    private readonly accessScope: AccessScopeService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Issue mutations are scoped to the function that owns the issue's audit
   * run. A function-viewer who is base 'editor' must not be able to comment,
   * correct, or acknowledge on a function they are scoped down on. We resolve
   * `issueKey -> auditRun.file.functionId` and require function:edit. If the
   * issue can't be resolved (orphan key), fall back to all-functions:edit.
   */
  private async requireFunctionEditForIssue(
    processIdOrCode: string,
    issueKey: string,
    user: SessionUser,
  ): Promise<void> {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'viewer');
    const issue = await this.prisma.auditIssue.findFirst({
      where: { issueKey, auditRun: { processId: process.id } },
      select: { auditRun: { select: { file: { select: { functionId: true } } } } },
    });
    const functionId = issue?.auditRun.file.functionId;
    if (functionId && isFunctionId(functionId)) {
      await this.accessScope.require(process.id, user, { kind: 'function', functionId, action: 'edit' });
    } else {
      await this.accessScope.require(process.id, user, { kind: 'all-functions', action: 'edit' });
    }
  }

  @Get('processes/:idOrCode/comments')
  listAllComments(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.issuesService.listAllComments(idOrCode, user);
  }

  @Get('processes/:idOrCode/issues/:issueKey/comments')
  listComments(
    @Param('idOrCode') idOrCode: string,
    @Param('issueKey') issueKey: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.issuesService.listComments(idOrCode, issueKey, user);
  }

  @Post('processes/:idOrCode/issues/:issueKey/comments')
  async addComment(
    @Param('idOrCode') idOrCode: string,
    @Param('issueKey') issueKey: string,
    @Body() body: AddIssueCommentDto,
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireFunctionEditForIssue(idOrCode, issueKey, user);
    return this.issuesService.addComment(idOrCode, issueKey, body, user);
  }

  @Delete('comments/:idOrCode')
  async deleteComment(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    // Comment delete has no process in path. Look up the comment to recover
    // the (processId, issueKey) tuple, then enforce function:edit.
    const comment = await this.prisma.issueComment.findFirst({
      where: { OR: [{ id: idOrCode }, { displayCode: idOrCode }] },
      select: { processId: true, issueKey: true },
    });
    if (!comment) throw new NotFoundException(`Comment ${idOrCode} not found`);
    await this.requireFunctionEditForIssue(comment.processId, comment.issueKey, user);
    return this.issuesService.deleteComment(idOrCode, user);
  }

  @Get('processes/:idOrCode/corrections')
  listCorrections(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.issuesService.listCorrections(idOrCode, user);
  }

  @Put('processes/:idOrCode/issues/:issueKey/correction')
  async saveCorrection(
    @Param('idOrCode') idOrCode: string,
    @Param('issueKey') issueKey: string,
    @Body() body: SaveCorrectionDto,
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireFunctionEditForIssue(idOrCode, issueKey, user);
    return this.issuesService.saveCorrection(idOrCode, issueKey, body, user);
  }

  @Delete('processes/:idOrCode/issues/:issueKey/correction')
  async clearCorrection(
    @Param('idOrCode') idOrCode: string,
    @Param('issueKey') issueKey: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireFunctionEditForIssue(idOrCode, issueKey, user);
    return this.issuesService.clearCorrection(idOrCode, issueKey, user);
  }

  @Get('processes/:idOrCode/acknowledgments')
  listAcknowledgments(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.issuesService.listAcknowledgments(idOrCode, user);
  }

  @Put('processes/:idOrCode/issues/:issueKey/acknowledgment')
  async saveAcknowledgment(
    @Param('idOrCode') idOrCode: string,
    @Param('issueKey') issueKey: string,
    @Body() body: SaveAcknowledgmentDto,
    @CurrentUser() user: SessionUser,
  ) {
    await this.requireFunctionEditForIssue(idOrCode, issueKey, user);
    return this.issuesService.saveAcknowledgment(idOrCode, issueKey, body, user);
  }
}
