import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { isFunctionId, type FunctionId, type SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/current-user';
import { AnalyticsService } from './analytics.service';
import { PinnedChartsService } from './pinned-charts.service';
import {
  AnomaliesQueryDto,
  ChatAnalyticsDto,
  ChatHistoryQueryDto,
  PinChartDto,
  ReorderPinnedChartsDto,
} from './dto/analytics.dto';

function asFunctionId(v: string | undefined): FunctionId | undefined {
  return v && isFunctionId(v) ? (v as FunctionId) : undefined;
}

@Controller('analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly pinnedCharts: PinnedChartsService,
  ) {}

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

  // Deterministic seed charts for the workbench (no LLM). Always available,
  // computed live from uploaded audit data across all functions.
  @Get('processes/:processCode/default-charts')
  async defaultCharts(
    @Param('processCode') processCode: string,
    @Query() q: ChatHistoryQueryDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.analytics.defaultCharts(processCode, user, asFunctionId(q.functionId));
  }

  // Pinned workbench: per (process, user) set of charts pinned from chat
  // answers. Scoped by the authenticated user — never shared.
  @Get('processes/:processCode/pinned-charts')
  async listPinnedCharts(
    @Param('processCode') processCode: string,
    @CurrentUser() user: SessionUser,
  ) {
    return this.pinnedCharts.list(user.id, processCode);
  }

  @Post('processes/:processCode/pinned-charts')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async pinChart(
    @Param('processCode') processCode: string,
    @Body() body: PinChartDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.pinnedCharts.pin({
      userId: user.id,
      processCode,
      functionId: asFunctionId(body.functionId) ?? null,
      title: body.title,
      question: body.question ?? null,
      chartSpec: body.chartSpec,
    });
  }

  @Delete('processes/:processCode/pinned-charts/:id')
  async unpinChart(
    @Param('processCode') processCode: string,
    @Param('id') id: string,
    @CurrentUser() user: SessionUser,
  ) {
    await this.pinnedCharts.unpin(user.id, processCode, id);
    return { ok: true };
  }

  @Put('processes/:processCode/pinned-charts/reorder')
  async reorderPinnedCharts(
    @Param('processCode') processCode: string,
    @Body() body: ReorderPinnedChartsDto,
    @CurrentUser() user: SessionUser,
  ) {
    await this.pinnedCharts.reorder(user.id, processCode, body.orderedIds);
    return { ok: true };
  }

  // F10: export runs several heavy Prisma aggregations + xlsx build. Cap it
  // tighter than the global 400/min so it can't be used as an amplification
  // / cost-abuse vector.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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
