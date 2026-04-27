import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuditResult, SessionUser } from '@ses/domain';
import {
  buildAuditReportHtml,
  buildAuditedWorkbookBuffer,
  buildIssuesCsv,
  createId,
} from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';
import { IdentifierService } from '../../common/identifier.service';
import { requestContext } from '../../common/request-context';
import { serializeIssue } from './audit-serializers';
import { AuditResultsService } from './audit-results.service';
import { buildDomainFile } from './audit-domain-file.helpers';

@Injectable()
export class AuditAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly auditResults: AuditResultsService,
  ) {}

  private async createExport(
    kind: string,
    format: string,
    processId: string,
    auditRunId: string,
    user: SessionUser,
    content: Buffer,
    contentType: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      return tx.export.create({
        data: {
          id: createId(),
          displayCode: await this.identifiers.nextExportCode(tx),
          processId,
          auditRunId,
          kind,
          format,
          requestedById: user.id,
          requestId: requestContext.get().requestId,
          status: 'ready',
          sizeBytes: content.byteLength,
          // PRISMA-JSON: content is Bytes in Prisma schema; Buffer satisfies at runtime but type is opaque
          content: content as any,
          contentType,
        } as any, // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
      });
    });
  }

  async buildExport(idOrCode: string, format: string, user: SessionUser, corrected = false) {
    const fmt = format.toLowerCase();
    if (fmt !== 'csv' && fmt !== 'xlsx' && fmt !== 'html') {
      throw new BadRequestException('format must be csv, xlsx, or html');
    }
    const run = await this.auditResults.getRunWithAccess(user, idOrCode);
    const file = await buildDomainFile(this.prisma, run.fileId);
    const issues = run.issues.map(serializeIssue);
    const corrections = corrected
      ? Object.fromEntries(
          (await this.prisma.issueCorrection.findMany({ where: { processId: run.processId } })).map((item) => [
            item.issueKey,
            {
              issueKey: item.issueKey,
              processId: item.processId,
              effort: item.correctedEffort ?? undefined,
              projectState: item.correctedState ?? undefined,
              projectManager: item.correctedManager ?? undefined,
              note: item.note,
              updatedAt: item.updatedAt.toISOString(),
            },
          ]),
        )
      : {};
    const result: AuditResult = {
      id: run.id,
      displayCode: run.displayCode,
      requestId: run.requestId,
      fileId: run.fileId,
      runAt: (run.completedAt ?? run.startedAt).toISOString(),
      scannedRows: run.scannedRows,
      flaggedRows: run.flaggedRows,
      issues,
      sheets: ((run.summary as { sheets?: AuditResult['sheets'] } | null)?.sheets ?? []),
      // PRISMA-JSON: policySnapshot is stored as Json; double-cast recovers the domain type
      policySnapshot: run.policySnapshot as unknown as AuditResult['policySnapshot'],
    };

    if (fmt === 'csv') {
      const content = Buffer.from(buildIssuesCsv(issues), 'utf8');
      const exportRecord = await this.createExport('audit_run', fmt, run.processId, run.id, user, content, 'text/csv; charset=utf-8');
      return { fileName: `${run.displayCode}.csv`, contentType: exportRecord.contentType!, content };
    }
    if (fmt === 'xlsx') {
      const content = Buffer.from(await buildAuditedWorkbookBuffer(file, result, corrections));
      const exportRecord = await this.createExport('audit_run', fmt, run.processId, run.id, user, content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return { fileName: `${run.displayCode}${corrected ? '-corrected' : ''}.xlsx`, contentType: exportRecord.contentType!, content };
    }
    const html = buildAuditReportHtml(run.displayCode, result, corrections);
    const content = Buffer.from(html, 'utf8');
    const exportRecord = await this.createExport('audit_run', 'html', run.processId, run.id, user, content, 'text/html; charset=utf-8');
    return { fileName: `${run.displayCode}.html`, contentType: exportRecord.contentType!, content };
  }
}
