import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './common/current-user';
import { parseIfMatch } from './common/http';
import { CreateProcessDto, UpdateProcessDto } from './dto/processes.dto';
import { ProcessesService } from './processes.service';

@Controller('processes')
@UseGuards(AuthGuard)
export class ProcessesController {
  constructor(private readonly processesService: ProcessesService) {}

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

  @Get(':idOrCode/members')
  listMembers(@Param('idOrCode') idOrCode: string, @CurrentUser() user: SessionUser) {
    return this.processesService.listMembers(idOrCode, user);
  }

  @Post(':idOrCode/members')
  addMember(
    @Param('idOrCode') idOrCode: string,
    @Body() body: { email?: string; userCode?: string; permission?: 'viewer' | 'editor' | 'owner' },
    @CurrentUser() user: SessionUser,
  ) {
    return this.processesService.addMember(idOrCode, body, user);
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
