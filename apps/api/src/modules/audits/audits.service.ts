import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '../../repositories/types';
import type { AuditIssue, AuditResult, SessionUser, WorkbookFile as DomainWorkbookFile } from '@ses/domain';
import {
  AUDIT_RULE_CATALOG,
  buildAuditReportHtml,
  buildAuditedWorkbookBuffer,
  buildIssuesCsv,
  createId,
  createIssueKey,
  mergeAuditResults,
  normalizeObservedManagerLabel,
  normalizeProcessPolicies,
  resolveFunctionPolicy,
  runAiPilotRules,
  runFunctionAudit,
} from '@ses/domain';
import type { FunctionId } from '@ses/domain';
import type { MappingSourceDto } from './dto/audits.dto';
import { PrismaService } from '../../common/prisma.service';
import { IdentifierService } from '../../common/identifier.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { ProcessAccessService } from '../../common/process-access.service';
import { requestContext } from '../../common/request-context';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { StatusReconcilerService } from '../tracking/status-reconciler.service';
import { resolveIssueEmailsFromDirectory } from '../directory/resolve-issue-emails';
import { AiPilotService } from '../ai-pilot/ai-pilot.service';

/**
 * Stable sha256 over the sorted identity of each issue, so re-runs against
 * an unchanged file skip creating duplicate SavedVersion rows.
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
  rule: { name: string; version: number; category: string; source?: string };
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
    ruleSource: issue.rule.source ?? 'system',
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
    rule: { name: string; version: number; category: string; source?: string };
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

type PersistedAuditIssue = AuditIssue & {
  persistedId: string;
  displayCode: string;
  issueKey: string;
};

/**
 * Manager lookup built from a mapping source (Master Data version or an
 * uploaded file). `byId` is keyed on normalized Project ID; `byName` is
 * keyed on normalized Project Name and only contains names that map to a
 * single distinct manager (ambiguous names are dropped). Project ID is the
 * preferred key; name is a fallback for data where IDs don't align across
 * functions.
 */
type ManagerMaps = { byId: Map<string, string>; byName: Map<string, string> };

@Injectable()
export class AuditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly realtime: RealtimeGateway,
    private readonly statusReconciler: StatusReconcilerService,
    private readonly aiPilot: AiPilotService,
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
      rawData: Object.fromEntries(file.sheets.map((sheet: any) => [sheet.sheetName, (sheet.rows as unknown[][]) ?? []])),
      sheets: file.sheets.map((sheet: any) => ({
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

  private prepareIssuesForPersistence(
    issues: AuditIssue[],
    processDisplayCode: string,
    displayCodes: string[],
  ): PersistedAuditIssue[] {
    return issues.map((issue, index) => ({
      ...issue,
      persistedId: createId(),
      displayCode: displayCodes[index]!,
      issueKey: createIssueKey(processDisplayCode, {
        projectNo: issue.projectNo,
        sheetName: issue.sheetName,
        rowIndex: issue.rowIndex,
        ruleCode: issue.ruleCode,
      }),
    }));
  }

  private assertKnownRuleCodes(
    issues: Array<{ persistedId: string; ruleCode?: string | null; ruleId?: string | null }>,
    validRuleCodes: Set<string>,
  ): void {
    for (const issue of issues) {
      const resolvedRuleCode = issue.ruleCode ?? issue.ruleId;
      if (!resolvedRuleCode) {
        throw new InternalServerErrorException(
          `Audit engine returned issue ${issue.persistedId} without a ruleCode.`,
        );
      }
      if (!validRuleCodes.has(resolvedRuleCode)) {
        throw new BadRequestException(
          `Audit produced unsupported rule code "${resolvedRuleCode}". Refresh audit rules and try again.`,
        );
      }
    }
  }

  async run(processIdOrCode: string, body: { fileIdOrCode: string; mappingSource?: MappingSourceDto }, user: SessionUser) {
    // Edit enforcement happens at the controller; here we only confirm read access
    // so a scoped editor (base viewer) isn't rejected for an authorized function.
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'viewer');
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

      // Legacy single-blob AuditPolicy normalises into the over-planning slice;
      // engines without policy (e.g. master-data) get an empty object.
      const processPolicies = normalizeProcessPolicies(process.auditPolicy);
      const resolvedFunctionId = (file.functionId ?? 'master-data') as FunctionId;
      const functionPolicy = resolveFunctionPolicy(processPolicies, resolvedFunctionId);
      // PRISMA-JSON: auditPolicy is stored as Json; cast satisfies domain runAudit signature
      const engineResult = runFunctionAudit(resolvedFunctionId, domainFile, functionPolicy as any, {
        issueScope: process.displayCode,
        runCode,
      });
      const aiSpecs = await this.aiPilot.loadActiveSpecs(resolvedFunctionId);
      const aiResult = runAiPilotRules(domainFile, {
        functionId: resolvedFunctionId,
        rules: aiSpecs,
        issueScope: process.displayCode,
        runCode,
      });
      const result = mergeAuditResults(engineResult, aiResult);

      // Pre-resolve emails when the audit workbook is authored separately from
      // the manager mapping file (over-planning, function-rate, ICR).
      let resolvedFromMapping = 0;
      let resolvedProjectIdToManager = 0;
      const mappingEnabledFunctions = new Set([
        'over-planning',
        'function-rate',
        'internal-cost-rate',
      ]);
      if (
        mappingEnabledFunctions.has(file.functionId ?? '') &&
        body.mappingSource &&
        body.mappingSource.type !== 'none'
      ) {
        // function-rate/ICR have no PM column; join Project ID against the
        // mapping source first so downstream name-based resolution sees a real
        // manager name instead of 'Unassigned'. Over-planning skips this.
        if (file.functionId === 'function-rate' || file.functionId === 'internal-cost-rate') {
          const idMap = await this.buildProjectIdToManagerMap(tx, process, file, body.mappingSource);
          resolvedProjectIdToManager = this.applyProjectIdToManager(result.issues, idMap);
        }
        const preMap = await this.buildMappingSourceMap(tx, process, file, body.mappingSource);
        resolvedFromMapping = this.applyPreResolvedEmails(result.issues, preMap);
      }

      // Master Data has no email column; over-planning also prefers directory
      // since it's canonical, not the workbook.
      const directoryResolution = await resolveIssueEmailsFromDirectory(
        tx,
        process.tenantId,
        result.issues,
      );

      const issueDisplayCodes = await Promise.all(
        result.issues.map(async () => this.identifiers.nextIssueCode(tx, runCode)),
      );
      const issuesWithCodes = this.prepareIssuesForPersistence(
        result.issues,
        process.displayCode,
        issueDisplayCodes,
      );
      const summary = {
        severity: this.severitySummary(issuesWithCodes),
        sheets: result.sheets,
        managerDirectory: {
          resolvedCount: directoryResolution.resolvedFromDirectory,
          unresolvedNames: directoryResolution.unresolvedManagerNames,
        },
        ...(file.functionId === 'over-planning'
          ? {
              overplanning: {
                pdThreshold: (functionPolicy as { pdThreshold?: number })?.pdThreshold ?? 30,
                mappingSourceType: body.mappingSource?.type ?? 'none',
                resolvedFromMapping,
                allowUnresolvedFallback: body.mappingSource?.allowUnresolvedFallback ?? true,
              },
            }
          : file.functionId === 'function-rate'
          ? {
              functionRate: {
                mappingSourceType: body.mappingSource?.type ?? 'none',
                resolvedProjectIdToManager,
                resolvedFromMapping,
                allowUnresolvedFallback: body.mappingSource?.allowUnresolvedFallback ?? true,
              },
            }
          : file.functionId === 'internal-cost-rate'
          ? {
              internalCostRate: {
                mappingSourceType: body.mappingSource?.type ?? 'none',
                resolvedProjectIdToManager,
                resolvedFromMapping,
                allowUnresolvedFallback: body.mappingSource?.allowUnresolvedFallback ?? true,
              },
            }
          : {}),
      };

      const validRuleCodes = new Set(
        (
          await tx.auditRule.findMany({
            select: { ruleCode: true },
          })
        ).map((rule) => rule.ruleCode),
      );
      this.assertKnownRuleCodes(issuesWithCodes, validRuleCodes);

      for (const issue of issuesWithCodes) {
        const resolvedRuleCode = issue.ruleCode ?? issue.ruleId;
        await tx.auditIssue.create({
          data: {
            id: issue.persistedId,
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
            missingMonths: issue.missingMonths ?? null,
            zeroMonthCount: issue.zeroMonthCount ?? null,
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

    // Emit after commit — emitting inside the tx would leak events on rollback.
    this.realtime.emitToProcess(process.displayCode, 'audit.completed', {
      runCode: result.displayCode,
      runId: result.id,
      fileId: file.id,
      fileCode: file.displayCode,
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

  // Latest completed audit run for a file. Used by deep links into the Audit
  // Results tab when no client-side cache of issues exists. 404 if none.
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

  // name → email map from either an uploaded mapping file or a completed master-data run.
  private async buildMappingSourceMap(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    process: { id: string; displayCode: string },
    auditFile: { id: string },
    src: MappingSourceDto,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    if (src.type === 'uploaded_file') {
      if (!src.uploadId) return map;
      if (src.uploadId === auditFile.id) {
        throw new BadRequestException('Mapping file must differ from the audit file');
      }
      const mf = await (tx as any).workbookFile.findFirst({
        where: { id: src.uploadId, processId: process.id },
      });
      if (!mf) throw new BadRequestException(`Mapping file ${src.uploadId} not found in this process`);
      const sheet = await (tx as any).workbookSheet.findFirst({ where: { fileId: mf.id } });
      const rows: unknown[][] = (sheet?.rows as unknown[][]) ?? [];
      if (rows.length < 2) return map;
      const headerRow = (rows[0] ?? []).map((c) => String(c ?? '').toLowerCase());
      const nameCol = headerRow.findIndex((h) => ['manager', 'name', 'project manager'].includes(h));
      const emailCol = headerRow.findIndex((h) => h === 'email');
      if (nameCol < 0 || emailCol < 0) return map;
      for (const row of rows.slice(1)) {
        const name = String((row as unknown[])[nameCol] ?? '').trim();
        const email = String((row as unknown[])[emailCol] ?? '').trim();
        if (name && email) map.set(normalizeObservedManagerLabel(name), email);
      }
      return map;
    }

    if (src.type === 'master_data_version') {
      if (!src.masterDataVersionId) return map;
      const run = await (tx as any).auditRun.findFirst({
        where: {
          id: src.masterDataVersionId,
          processId: process.id,
          status: 'completed',
          file: { functionId: 'master-data' },
        },
      });
      if (!run) {
        throw new BadRequestException(
          'Master Data version not found, or does not belong to this process, or is not completed',
        );
      }
      const issues = await (tx as any).auditIssue.findMany({
        where: { auditRunId: run.id },
        select: { projectManager: true, email: true },
      });
      for (const issue of issues) {
        const name = String(issue.projectManager ?? '').trim();
        const email = String(issue.email ?? '').trim();
        if (name && email) map.set(normalizeObservedManagerLabel(name), email);
      }
      return map;
    }

    return map;
  }

  private applyPreResolvedEmails(issues: AuditIssue[], map: Map<string, string>): number {
    let count = 0;
    for (const issue of issues) {
      if (issue.email) continue;
      const key = normalizeObservedManagerLabel(issue.projectManager ?? '');
      const email = map.get(key);
      if (email) {
        issue.email = email;
        count += 1;
      }
    }
    return count;
  }

  // function-rate/ICR pre-pass: resolve PM name by Project ID against the
  // mapping source so downstream name-based stages can resolve emails. Gated
  // by functionId at the call site so over-planning is unaffected.
  private async buildProjectIdToManagerMap(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    process: { id: string; displayCode: string },
    auditFile: { id: string },
    src: MappingSourceDto,
  ): Promise<ManagerMaps> {
    const byId = new Map<string, string>();
    // Name → managers seen. A name is only a usable fallback key when it maps
    // to exactly ONE distinct manager in the source (guards against the
    // sample data where a project name could otherwise be ambiguous).
    const nameToManagers = new Map<string, Set<string>>();
    const normKey = (v: unknown) => String(v ?? '').trim().toLowerCase();
    const normName = (v: unknown) =>
      String(v ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    const addName = (name: string, pm: string) => {
      const k = normName(name);
      if (!k || !pm) return;
      const set = nameToManagers.get(k) ?? new Set<string>();
      set.add(pm);
      nameToManagers.set(k, set);
    };
    const finish = (): ManagerMaps => {
      const byName = new Map<string, string>();
      for (const [name, mgrs] of nameToManagers) {
        if (mgrs.size === 1) byName.set(name, [...mgrs][0]!);
      }
      return { byId, byName };
    };

    if (src.type === 'uploaded_file') {
      if (!src.uploadId) return finish();
      // audit file cannot also be its own mapping source.
      if (src.uploadId === auditFile.id) {
        throw new BadRequestException('Mapping file must differ from the audit file');
      }
      const mf = await (tx as any).workbookFile.findFirst({
        where: { id: src.uploadId, processId: process.id },
      });
      if (!mf) {
        throw new BadRequestException(`Mapping file ${src.uploadId} not found in this process`);
      }
      const sheet = await (tx as any).workbookSheet.findFirst({ where: { fileId: mf.id } });
      const rows: unknown[][] = (sheet?.rows as unknown[][]) ?? [];
      if (rows.length < 2) return finish();
      const headerRow = (rows[0] ?? []).map((c) => String(c ?? '').toLowerCase().trim());
      const idCol = headerRow.findIndex((h) =>
        ['project id', 'project no', 'project no.', 'project number', 'projectno'].includes(h),
      );
      const pmCol = headerRow.findIndex((h) =>
        ['project manager', 'manager', 'projectmanager'].includes(h),
      );
      const nameCol = headerRow.findIndex((h) =>
        ['project name', 'projectname', 'project'].includes(h),
      );
      if (idCol < 0 || pmCol < 0) return finish();
      for (const row of rows.slice(1)) {
        const id = normKey((row as unknown[])[idCol]);
        const pm = String((row as unknown[])[pmCol] ?? '').trim();
        if (id && pm && !byId.has(id)) byId.set(id, pm);
        if (nameCol >= 0) addName(String((row as unknown[])[nameCol] ?? ''), pm);
      }
      return finish();
    }

    if (src.type === 'master_data_version') {
      if (!src.masterDataVersionId) return finish();
      const run = await (tx as any).auditRun.findFirst({
        where: {
          id: src.masterDataVersionId,
          processId: process.id,
          status: 'completed',
          file: { functionId: 'master-data' },
        },
      });
      if (!run) {
        throw new BadRequestException(
          'Master Data version not found, or does not belong to this process, or is not completed',
        );
      }
      const issues = await (tx as any).auditIssue.findMany({
        where: { auditRunId: run.id },
        select: { projectNo: true, projectName: true, projectManager: true },
      });
      for (const issue of issues) {
        const id = normKey(issue.projectNo);
        const pm = String(issue.projectManager ?? '').trim();
        // First occurrence wins — MD runs typically have multiple issues per project.
        if (id && pm && !byId.has(id)) byId.set(id, pm);
        addName(issue.projectName, pm);
      }
    }

    return finish();
  }

  // Populate projectManager from the mapping source: match by Project ID
  // first (preserves prior behaviour), then fall back to Project Name when
  // the ID has no match. Never overwrites an already-populated name, so this
  // pre-pass stays additive and safe to re-run. The name map only contains
  // unambiguous names (see buildProjectIdToManagerMap), so the fallback can't
  // mis-assign when a name maps to multiple managers in the source.
  private applyProjectIdToManager(issues: AuditIssue[], maps: ManagerMaps): number {
    if (maps.byId.size === 0 && maps.byName.size === 0) return 0;
    let count = 0;
    for (const issue of issues) {
      const current = (issue.projectManager ?? '').trim();
      if (current && current.toLowerCase() !== 'unassigned') continue;
      const idKey = String(issue.projectNo ?? '').trim().toLowerCase();
      const nameKey = String(issue.projectName ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      const pm =
        (idKey ? maps.byId.get(idKey) : undefined) ??
        (nameKey ? maps.byName.get(nameKey) : undefined);
      if (pm) {
        issue.projectManager = pm;
        count += 1;
      }
    }
    return count;
  }

  async listForProcess(processIdOrCode: string, functionId: string | undefined, user: SessionUser) {
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'viewer');
    return this.prisma.auditRun.findMany({
      where: {
        processId: process.id,
        status: 'completed',
        ...(functionId ? { file: { functionId } } : {}),
      },
      orderBy: { completedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        displayCode: true,
        completedAt: true,
        scannedRows: true,
        flaggedRows: true,
        file: { select: { functionId: true, name: true, displayCode: true } },
      },
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
