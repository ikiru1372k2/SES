import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { AddIssueCommentDto, SaveAcknowledgmentDto, SaveCorrectionDto } from './dto/issues.dto';
import { IssuesService } from './issues.service';

@Controller()
@UseGuards(AuthGuard)
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

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
  addComment(
    @Param('idOrCode') idOrCode: string,
    @Param('issueKey') issueKey: string,
    @Body() body: AddIssueCommentDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.issuesService.addComment(idOrCode, issueKey, body, user);
  }

  @Delete('comments/:idOrCode')
  deleteComment(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.issuesService.deleteComment(idOrCode, user);
  }

  @Get('processes/:idOrCode/corrections')
  listCorrections(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.issuesService.listCorrections(idOrCode, user);
  }

  @Put('processes/:idOrCode/issues/:issueKey/correction')
  saveCorrection(
    @Param('idOrCode') idOrCode: string,
    @Param('issueKey') issueKey: string,
    @Body() body: SaveCorrectionDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.issuesService.saveCorrection(idOrCode, issueKey, body, user);
  }

  @Delete('processes/:idOrCode/issues/:issueKey/correction')
  clearCorrection(
    @Param('idOrCode') idOrCode: string,
    @Param('issueKey') issueKey: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.issuesService.clearCorrection(idOrCode, issueKey, user);
  }

  @Get('processes/:idOrCode/acknowledgments')
  listAcknowledgments(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.issuesService.listAcknowledgments(idOrCode, user);
  }

  @Put('processes/:idOrCode/issues/:issueKey/acknowledgment')
  saveAcknowledgment(
    @Param('idOrCode') idOrCode: string,
    @Param('issueKey') issueKey: string,
    @Body() body: SaveAcknowledgmentDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.issuesService.saveAcknowledgment(idOrCode, issueKey, body, user);
  }
}
