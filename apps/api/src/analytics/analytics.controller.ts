import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { isFunctionId, type FunctionId, type SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth.guard';
import { CurrentUser } from '../common/current-user';
import { AnalyticsService } from './analytics.service';
import {
  AnomaliesQueryDto,
  ChatAnalyticsDto,
  ChatHistoryQueryDto,
} from './dto/analytics.dto';

function asFunctionId(v: string | undefined): FunctionId | undefined {
  return v && isFunctionId(v) ? (v as FunctionId) : undefined;
}

@Controller('analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('health')
  async health() {
    return this.analytics.health();
  }

  @Get('processes/:processCode/summary')
  async summary(
    @Param('processCode') processCode: string,
    @Query('functionId') functionId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    return this.analytics.summary(processCode, user, asFunctionId(functionId));
  }

  @Get('processes/:processCode/timeseries')
  async timeseries(
    @Param('processCode') processCode: string,
    @Query('functionId') functionId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    return this.analytics.timeseries(processCode, user, asFunctionId(functionId));
  }

  @Get('processes/:processCode/managers')
  async managers(
    @Param('processCode') processCode: string,
    @Query('functionId') functionId: string | undefined,
    @CurrentUser() user: SessionUser,
  ) {
    return this.analytics.managers(processCode, user, asFunctionId(functionId));
  }

  @Get('processes/:processCode/anomalies')
  async anomalies(
    @Param('processCode') processCode: string,
    @Query() q: AnomaliesQueryDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.analytics.anomalies(processCode, user, asFunctionId(q.functionId));
  }

  @Post('processes/:processCode/chat')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async chat(
    @Param('processCode') processCode: string,
    @Body() body: ChatAnalyticsDto,
    @CurrentUser() user: SessionUser,
    @Res() res: Response,
  ) {
    await this.analytics.streamChat(
      processCode,
      user,
      {
        question: body.question,
        functionId: asFunctionId(body.functionId),
        versionRef: body.versionRef,
        compareTo: body.compareTo,
        useStub: body.useStub ?? true,
      },
      res,
    );
  }

  @Get('processes/:processCode/chat/history')
  async history(
    @Param('processCode') processCode: string,
    @Query() q: ChatHistoryQueryDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.analytics.chatHistory(processCode, user, asFunctionId(q.functionId));
  }

  @Get('processes/:processCode/export.xlsx')
  async exportXlsx(
    @Param('processCode') processCode: string,
    @Query('functionId') functionId: string | undefined,
    @CurrentUser() user: SessionUser,
    @Res() res: Response,
  ) {
    return this.analytics.exportXlsx(processCode, user, asFunctionId(functionId), res);
  }
}
