import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { SessionUser } from '@ses/domain';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../../common/current-user';
import { PdfProcessingService } from './pdf-processing.service';
import type { PdfJobKind, PdfProcessingJobRow } from '../../db/types';

interface StartJobBody {
  uploadedObjectId?: string;
  kind?: string;
  prompt?: string;
  options?: Record<string, unknown>;
}

const ALLOWED_KINDS: ReadonlySet<PdfJobKind> = new Set(['extract', 'summarize']);

@Controller('pdf-processing/jobs')
@UseGuards(AuthGuard)
export class PdfProcessingController {
  constructor(private readonly service: PdfProcessingService) {}

  @Post()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async start(@Body() body: StartJobBody, @CurrentUser() user: SessionUser) {
    if (!body.uploadedObjectId) throw new BadRequestException('uploadedObjectId required');
    if (!body.kind || !ALLOWED_KINDS.has(body.kind as PdfJobKind)) {
      throw new BadRequestException(`kind must be one of ${[...ALLOWED_KINDS].join(', ')}`);
    }
    const result = await this.service.startJob({
      tenantId: (user as { tenantId?: string }).tenantId ?? null,
      requestedById: user.id,
      uploadedObjectId: body.uploadedObjectId,
      kind: body.kind as PdfJobKind,
      prompt: body.prompt,
      options: body.options,
    });
    return { job: serialize(result.job), deduplicated: result.deduplicated };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const job = await this.service.getJob(id);
    return { job: serialize(job) };
  }
}

function serialize(j: PdfProcessingJobRow) {
  return {
    id: j.id,
    tenantId: j.tenantId,
    requestedById: j.requestedById,
    kind: j.kind,
    status: j.status,
    uploadedObjectId: j.uploadedObjectId,
    attempt: j.attempt,
    result: j.result,
    errorCode: j.errorCode,
    errorMessage: j.errorMessage,
    startedAt: j.startedAt?.toISOString() ?? null,
    finishedAt: j.finishedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  };
}
