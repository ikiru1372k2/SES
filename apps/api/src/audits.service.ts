import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AuditIssue, AuditResult, SessionUser, WorkbookFile as DomainWorkbookFile } from '@ses/domain';
import {
  AUDIT_RULE_CATALOG,
  buildAuditReportHtml,
  buildAuditedWorkbookBuffer,
  buildIssuesCsv,
  createId,
  createIssueKey,
  normalizeProcessPolicies,
  resolveFunctionPolicy,
  runFunctionAudit,
} from '@ses/domain';
import type { FunctionId } from '@ses/domain';
import { PrismaService } from './common/prisma.service';
import { IdentifierService } from './common/identifier.service';
import { ActivityLogService } from './common/activity-log.service';
import { ProcessAccessService } from './common/process-access.service';
import { requestContext } from './common/request-context';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { StatusReconcilerService } from './status-reconciler.service';
import { resolveIssueEmailsFromDirectory } from './directory/resolve-issue-emails';

/**
 * Stable sha256 over the sorted identity of each issue.
 * Two runs with the same issues (any order) produce the same hash, so the
 * web store can skip creating duplicate SavedVersion rows when an auditor
 * re-runs against an unchanged file.
 */
function computeFindingsHash(
  issues: Array<{ issueKey: string; ruleCode?: string | null; severity?: string | null }>,
): string {
  const normalized = issues
    .map((i) => `${i.issueKey}|${i.ruleCode ?? ''}|${i.severity ?? ''}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(`${issues.length}\n${normalized}`).digest('hex');
}

function serializeIssue(issue: {
  id: string;
  displayCode: string;
  issueKey: string;
  ruleCode: string;
  projectNo: string | null;
  projectName: string | null;
  sheetName: string | null;
  projectManager: string | null;
  projectState: string | null;
  effort: number | null;
  severity: string;
  reason: string | null;
  thresholdLabel: string | null;
  recommendedAction: string | null;
  email: string | null;
  rowIndex: number | null;
  auditRun: { displayCode: string };
  rule: { name: string; version: number; category: string };
}) {
  return {
    id: issue.id,
    displayCode: issue.displayCode,
    issueKey: issue.issueKey,
    projectNo: issue.projectNo ?? '',
    projectName: issue.projectName ?? '',
    sheetName: issue.sheetName ?? '',
    severity: issue.severity as AuditIssue['severity'],
    projectManager: issue.projectManager ?? '',
    projectState: issue.projectState ?? '',
    effort: issue.effort ?? 0,
    auditStatus: issue.ruleCode,
    notes: issue.reason ?? '',
    rowIndex: issue.rowIndex ?? 0,
    email: issue.email ?? '',
    ruleId: issue.ruleCode,
    ruleCode: issue.ruleCode,
    ruleVersion: issue.rule.version,
    ruleName: issue.rule.name,
    auditRunCode: issue.auditRun.displayCode,
    category: issue.rule.category as AuditIssue['category'],
    reason: issue.reason ?? '',
    thresholdLabel: issue.thresholdLabel ?? '',
    recommendedAction: issue.recommendedAction ?? '',
  };
}

function serializeRun(run: {
  id: string;
  displayCode: string;
  fileId: string;
  requestId: string;
  status: string;
  source: string;
  scannedRows: number;
  flaggedRows: number;
  findingsHash?: string;
  startedAt: Date;
  completedAt: Date | null;
  issues?: Array<{
    id: string;
    displayCode: string;
    issueKey: string;
    ruleCode: string;
    projectNo: string | null;
    projectName: string | null;
    sheetName: string | null;
    projectManager: string | null;
    projectState: string | null;
    effort: number | null;
    severity: string;
    reason: string | null;
    thresholdLabel: string | null;
    recommendedAction: string | null;
    email: string | null;
    rowIndex: number | null;
    auditRun: { displayCode: string };
    rule: { name: string; version: number; category: string };
  }>;
  policySnapshot: unknown;
  summary: unknown;
}) {
  const issues = run.issues?.map(serializeIssue) ?? [];
  return {
    id: run.id,
    displayCode: run.displayCode,
    fileId: run.fileId,
    requestId: run.requestId,
    status: run.status,
    source: run.source,
    runAt: (run.completedAt ?? run.startedAt).toISOString(),
    scannedRows: run.scannedRows,
    flaggedRows: run.flaggedRows,
    findingsHash: run.findingsHash ?? '',
    issues,
    sheets: ((run.summary as { sheets?: AuditResult['sheets'] } | null)?.sheets ?? []),
    policySnapshot: run.policySnapshot,
    summary: run.summary,
  };
}

@Injectable()
export class AuditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly realtime: RealtimeGateway,
    private readonly statusReconciler: StatusReconcilerService,
  ) {}

  private async getRunWithAccess(user: SessionUser, idOrCode: string) {
    const match: Prisma.AuditRunWhereInput = {
      OR: [{ id: idOrCode }, { displayCode: idOrCode }],
    };
    const scope = this.processAccess.whereProcessReadableBy(user);
    const run = await this.prisma.auditRun.findFirst({
      where: scope ? { AND: [match, { process: scope }] } : match,
      include: {
        issues: { include: { auditRun: true, rule: true }, orderBy: { displayCode: 'asc' } },
      },
    });
    if (!run) throw new NotFoundException(`Audit run ${idOrCode} not found`);
    await this.processAccess.assertCanAccessProcess(user, run.processId);
    return run;
  }

  private async buildDomainFile(fileId: string): Promise<DomainWorkbookFile> {
    const file = await this.prisma.workbookFile.findUnique({
      where: { id: fileId },
      include: { sheets: { orderBy: { sheetName: 'asc' } } },
    });
    if (!file) throw new NotFoundException(`File ${fileId} not found`);
    return {
      id: file.id,
      displayCode: file.displayCode,
      name: file.name,
      processId: file.processId,
      rowVersion: file.rowVersion,
      uploadedAt: file.uploadedAt.toISOString(),
      lastAuditedAt: file.lastAuditedAt?.toISOString() ?? null,
      isAudited: Boolean(file.lastAuditedAt),
      rawData: Object.fromEntries(file.sheets.map((sheet) => [sheet.sheetName, (sheet.rows as unknown[][]) ?? []])),
      sheets: file.sheets.map((sheet) => ({
        id: sheet.id,
        displayCode: sheet.displayCode,
        name: sheet.sheetName,
        status: sheet.status as DomainWorkbookFile['sheets'][number]['status'],
        rowCount: sheet.rowCount,
        isSelected: sheet.isSelected,
        headerRowIndex: sheet.headerRowIx ?? undefined,
        originalHeaders: (sheet.originalHeaders as string[] | null) ?? undefined,
        normalizedHeaders: (sheet.normalizedHeaders as string[] | null) ?? undefined,
      })),
    };
  }

  private severitySummary(issues: AuditIssue[]) {
    return {
      high: issues.filter((issue) => issue.severity === 'High').length,
      medium: issues.filter((issue) => issue.severity === 'Medium').length,
      low: issues.filter((issue) => issue.severity === 'Low').length,
    };
  }

  async run(processIdOrCode: string, body: { fileIdOrCode: string }, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'editor');
    const file = await this.prisma.workbookFile.findFirst({
      where: {
        processId: process.id,
        OR: [{ id: body.fileIdOrCode }, { displayCode: body.fileIdOrCode }],
      },
    });
    if (!file) throw new NotFoundException(`File ${body.fileIdOrCode} not found`);
    const domainFile = await this.buildDomainFile(file.id);

    const actor = {
      id: user.id,
      code: user.displayCode,
      email: user.email,
      displayName: user.displayName,
    };

    const result = await this.prisma.$transaction(async (tx) => {
      const runCode = await this.identifiers.nextRunCode(tx, process.displayCode);
      const totalRows = domainFile.sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0);
      const shouldTrackJob = totalRows > 10_000;
      const job = shouldTrackJob
        ? await tx.job.create({
            data: {
              id: createId(),
              displayCode: await this.identifiers.nextJobCode(tx),
              kind: 'audit_run',
              processId: process.id,
              requestId: requestContext.get().requestId,
              state: 'running',
              createdById: user.id,
              payload: { fileId: file.id, fileCode: file.displayCode },
            },
          })
        : null;

      const createdRun = await tx.auditRun.create({
        data: {
          id: createId(),
          displayCode: runCode,
          processId: process.id,
          fileId: file.id,
          requestId: requestContext.get().requestId,
          status: 'running',
          source: job ? 'job' : 'inline',
          // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
          policySnapshot: process.auditPolicy as any,
          rulesSnapshot: AUDIT_RULE_CATALOG.map((rule) => ({ ruleCode: rule.ruleCode, version: rule.version })),
          summary: {},
          ranById: user.id,
        } as any, // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
      });

      // Resolve the policy slice for this function. Legacy single-blob
      // AuditPolicy rows normalise into the over-planning slice; new
      // ProcessPolicies rows are passed through unchanged. Engines that
      // don't use policy (like master-data) get an empty object.
      const processPolicies = normalizeProcessPolicies(process.auditPolicy);
      const resolvedFunctionId = (file.functionId ?? 'master-data') as FunctionId;
      const functionPolicy = resolveFunctionPolicy(processPolicies, resolvedFunctionId);
      // PRISMA-JSON: auditPolicy is stored as Json; cast satisfies domain runAudit signature
      const result = runFunctionAudit(resolvedFunctionId, domainFile, functionPolicy as any, {
        issueScope: process.displayCode,
        runCode,
      });

      // Master Data exports have no email column at all — every owner must
      // be looked up from the tenant's Manager Directory. For over-planning
      // we also prefer the directory: it's canonical, the workbook isn't.
      const directoryResolution = await resolveIssueEmailsFromDirectory(
        tx,
        process.tenantId,
        result.issues,
      );

      const issuesWithCodes = await Promise.all(result.issues.map(async (issue) => ({
        ...issue,
        displayCode: await this.identifiers.nextIssueCode(tx, runCode),
        issueKey: createIssueKey(process.displayCode, {
          projectNo: issue.projectNo,
          sheetName: issue.sheetName,
          rowIndex: issue.rowIndex,
          ruleCode: issue.ruleCode,
        }),
      })));
      const summary = {
        severity: this.severitySummary(issuesWithCodes),
        sheets: result.sheets,
        managerDirectory: {
          resolvedCount: directoryResolution.resolvedFromDirectory,
          unresolvedNames: directoryResolution.unresolvedManagerNames,
        },
      };

      for (const issue of issuesWithCodes) {
        // Every engine must emit a ruleCode that exists in AUDIT_RULE_CATALOG
        // so the AuditIssue → AuditRule FK holds. We never silently coerce
        // a Master Data finding into an effort-engine rule, so fail loud
        // if an engine ever returns an issue without one.
        const resolvedRuleCode = issue.ruleCode ?? issue.ruleId;
        if (!resolvedRuleCode) {
          throw new Error(`Audit engine returned issue ${issue.id} without a ruleCode.`);
        }
        await tx.auditIssue.create({
          data: {
            id: issue.id,
            displayCode: issue.displayCode!,
            issueKey: issue.issueKey!,
            auditRunId: createdRun.id,
            ruleCode: resolvedRuleCode,
            projectNo: issue.projectNo,
            projectName: issue.projectName,
            sheetName: issue.sheetName,
            projectManager: issue.projectManager,
            projectState: issue.projectState,
            effort: issue.effort,
            severity: issue.severity,
            reason: issue.reason,
            thresholdLabel: issue.thresholdLabel,
            recommendedAction: issue.recommendedAction,
            email: issue.email,
            rowIndex: issue.rowIndex,
          } as any, // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
        });
      }

      const findingsHash = computeFindingsHash(
        issuesWithCodes.map((i) => ({
          issueKey: i.issueKey!,
          ruleCode: i.ruleCode ?? i.ruleId ?? '',
          severity: i.severity,
        })),
      );

      const completedRun = await tx.auditRun.update({
        where: { id: createdRun.id },
        data: {
          status: 'completed',
          scannedRows: result.scannedRows,
          flaggedRows: result.flaggedRows,
          findingsHash,
          // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
          summary: summary as any,
          completedAt: new Date(result.runAt),
        } as any, // PRISMA-JSON: unavoidable until Prisma 6 supports typed JSON columns
        include: {
          issues: { include: { auditRun: true, rule: true }, orderBy: { displayCode: 'asc' } },
        },
      });

      await tx.workbookFile.update({
        where: { id: file.id },
        data: { lastAuditedAt: new Date(result.runAt) },
      });

      await this.statusReconciler.reconcileAfterAudit(tx, {
        processId: process.id,
        functionId: file.functionId,
        auditRunId: completedRun.id,
      });

      if (job) {
        await tx.job.update({
          where: { id: job.id },
          data: {
            state: 'succeeded',
            finishedAt: new Date(),
            result: { runCode, flaggedRows: result.flaggedRows },
          },
        });
      }

      await this.activity.append(tx, {
        actorId: user.id,
        actorEmail: user.email,
        processId: process.id,
        entityType: 'audit_run',
        entityId: completedRun.id,
        entityCode: completedRun.displayCode,
        action: 'audit.run_completed',
        after: { runCode, flaggedRows: completedRun.flaggedRows, jobCode: job?.displayCode ?? null },
      });

      return {
        ...serializeRun(completedRun),
        jobCode: job?.displayCode ?? null,
      };
    });

    // After-commit realtime emissions. We deliberately do NOT emit inside the
    // transaction: a rollback would leave clients with events for state that
    // never landed in the DB.
    this.realtime.emitToProcess(process.displayCode, 'audit.completed', {
      runCode: result.displayCode,
      runId: result.id,
      flaggedRows: result.flaggedRows,
      scannedRows: result.scannedRows,
    }, { actor });
    this.realtime.emitToProcess(process.displayCode, 'activity.appended', {
      activityCode: '', // activity log code lives in DB; clients refetch the activity feed
      entityType: 'audit_run',
      entityCode: result.displayCode,
      action: 'audit.run_completed',
    }, { actor });

    return result;
  }

  async get(idOrCode: string, user: SessionUser) {
    return serializeRun(await this.getRunWithAccess(user, idOrCode));
  }

  async issues(idOrCode: string, user: SessionUser) {
    const run = await this.getRunWithAccess(user, idOrCode);
    return run.issues.map(serializeIssue);
  }

  // Latest completed audit run for a given file. Used by the web client
  // when the user lands on the Audit Results tab via a deep link (e.g.
  // "Open evidence" from the Escalation Center) — at that point the
  // Zustand `currentAuditResult` is null because the run wasn't initiated
  // from this browser session, and there's no other client-side cache of
  // the issue list. Returns 404 if no completed run exists for the file
  // yet (caller should treat as "no audit run yet").
  async latestForFile(processIdOrCode: string, fileIdOrCode: string, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode);
    const file = await this.prisma.workbookFile.findFirst({
      where: {
        processId: process.id,
        OR: [{ id: fileIdOrCode }, { displayCode: fileIdOrCode }],
      },
      select: { id: true },
    });
    if (!file) throw new NotFoundException(`File ${fileIdOrCode} not found`);
    const run = await this.prisma.auditRun.findFirst({
      where: {
        processId: process.id,
        fileId: file.id,
        OR: [{ status: 'completed' }, { completedAt: { not: null } }],
      },
      orderBy: [{ completedAt: 'desc' }, { startedAt: 'desc' }],
      include: {
        issues: { include: { auditRun: true, rule: true }, orderBy: { displayCode: 'asc' } },
      },
    });
    if (!run) throw new NotFoundException(`No completed audit run for file ${fileIdOrCode}`);
    return serializeRun(run);
  }

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
    const run = await this.getRunWithAccess(user, idOrCode);
    const file = await this.buildDomainFile(run.fileId);
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