import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { RulesService } from './rules.service';

@Controller('rules')
@UseGuards(AuthGuard)
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  @Get()
  list(@Query('functionId') functionId?: string) {
    return this.rulesService.list(functionId);
  }

  @Get(':ruleCode')
  get(@Param('ruleCode') ruleCode: string) {
    return this.rulesService.get(ruleCode);
  }
}
