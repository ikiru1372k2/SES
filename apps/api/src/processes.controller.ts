import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { FunctionAccessGuard } from './common/function-access.guard';
import { CurrentUser } from './common/current-user';
import { parseIfMatch } from './common/http';
import { RequiresScope } from './common/requires-scope.decorator';
import { CreateFunctionAuditRequestDto, CreateProcessDto, UpdateProcessDto } from './dto/processes.dto';
import { AddProcessMemberDto, UpdateProcessMemberDto } from './dto/process-members.dto';
import { EscalationsService } from './escalations.service';
import { ProcessesService } from './processes.service';

@Controller('processes')
@UseGuards(AuthGuard, FunctionAccessGuard)
export class ProcessesController {
  constructor(
    private readonly processesService: ProcessesService,
    private readonly escalationsService: EscalationsService,
  ) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.processesService.list(user);
  }

  @Post()
  create(@Body() body: CreateProcessDto, @CurrentUser() user: SessionUser) {
    return this.processesService.create(body, user);
  }

  @Get(':idOrCode')
  get(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.processesService.get(idOrCode, user);
  }

  @Delete(':idOrCode')
  delete(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.processesService.delete(idOrCode, user);
  }

  @Patch(':idOrCode')
  update(
    @Param('idOrCode') idOrCode: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: UpdateProcessDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.processesService.update(idOrCode, parseIfMatch(ifMatch), body, user);
  }

  @Get(':idOrCode/policy')
  getPolicy(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.processesService.getPolicy(idOrCode, user);
  }

  @Put(':idOrCode/policy')
  updatePolicy(
    @Param('idOrCode') idOrCode: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: SessionUser,
  ) {
    return this.processesService.updatePolicy(idOrCode, parseIfMatch(ifMatch), body, user);
  }

  @Get(':idOrCode/tiles')
  tiles(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.processesService.tiles(idOrCode, user);
  }

  @Get(':idOrCode/escalations')
  @RequiresScope({ kind: 'escalation-center', action: 'view' })
  escalations(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.escalationsService.getForProcess(idOrCode, user);
  }

  @Post(':idOrCode/function-audit-requests')
  requestFunctionAudit(
    @Param('idOrCode') idOrCode: string,
    @Body() body: CreateFunctionAuditRequestDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.processesService.createFunctionAuditRequest(idOrCode, body, user);
  }

  @Get(':idOrCode/members')
  listMembers(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.processesService.listMembers(idOrCode, user);
  }

  @Post(':idOrCode/members')
  addMember(
    @Param('idOrCode') idOrCode: string,
    @Body() body: AddProcessMemberDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.processesService.addMember(idOrCode, body, user);
  }

  @Patch(':idOrCode/members/:memberIdOrCode')
  updateMember(
    @Param('idOrCode') idOrCode: string,
    @Param('memberIdOrCode') memberIdOrCode: string,
    @Body() body: UpdateProcessMemberDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.processesService.updateMember(idOrCode, memberIdOrCode, body, user);
  }

  @Delete(':idOrCode/members/:memberIdOrCode')
  removeMember(
    @Param('idOrCode') idOrCode: string,
    @Param('memberIdOrCode') memberIdOrCode: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.processesService.removeMember(idOrCode, memberIdOrCode, user);
  }
}
