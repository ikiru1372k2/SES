import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { AuditIssue, SessionUser } from '@ses/domain';
import {
  AUDIT_RULE_CATALOG,
  createId,
  createIssueKey,
  mergeAuditResults,
  normalizeProcessPolicies,
  resolveFunctionPolicy,
  runAiPilotRules,
  runFunctionAudit,
} from '@ses/domain';
import type { FunctionId } from '@ses/domain';
import type { MappingSourceDto } from '../../dto/audits.dto';
import { PrismaService } from '../../common/prisma.service';
import { IdentifierService } from '../../common/identifier.service';
import { ActivityLogService } from '../../common/activity-log.service';
import { ProcessAccessService } from '../../common/process-access.service';
import { requestContext } from '../../common/request-context';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { StatusReconcilerService } from '../../status-reconciler.service';
import { resolveIssueEmailsFromDirectory } from '../../directory/resolve-issue-emails';
import { AiPilotService } from '../../ai-pilot/ai-pilot.service';
import { computeFindingsHash, serializeRun } from './audit-serializers';
import {
  applyPreResolvedEmails,
  applyProjectIdToManager,
  buildMappingSourceMap,
  buildProjectIdToManagerMap,
} from './audit-mapping.helpers';
import { buildDomainFile, severitySummary } from './audit-domain-file.helpers';

type PersistedAuditIssue = AuditIssue & {
  persistedId: string;
  displayCode: string;
  issueKey: string;
};

@Injectable()
export class AuditRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identifiers: IdentifierService,
    private readonly activity: ActivityLogService,
    private readonly processAccess: ProcessAccessService,
    private readonly realtime: RealtimeGateway,
    private readonly statusReconciler: StatusReconcilerService,
    private readonly aiPilot: AiPilotService,
  ) {}

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

  async run(
    processIdOrCode: string,
    body: { fileIdOrCode: string; mappingSource?: MappingSourceDto },
    user: SessionUser,
  ) {
    // Scope-aware edit enforcement happens at the controller boundary. By the
    // time we reach the service we only need to confirm the caller can see the
    // process, otherwise a scoped editor (base viewer) is rejected here even
    // though they were correctly authorized for this function.
    const process = await this.processAccess.findAccessibleProcessOrThrow(user, processIdOrCode, 'viewer');
    const file = await this.prisma.workbookFile.findFirst({
      where: {
        processId: process.id,
        OR: [{ id: body.fileIdOrCode }, { displayCode: body.fileIdOrCode }],
      },
    });
    if (!file) throw new NotFoundException(`File ${body.fileIdOrCode} not found`);
    const domainFile = await buildDomainFile(this.prisma, file.id);

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

      // Pre-resolve emails from an explicit mapping source. Enabled for
      // functions whose audit workbook is authored separately from the
      // manager mapping file (over-planning, function-rate, internal-cost-rate).
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
        // Project ID → Project Manager name pre-pass. Applies to functions
        // whose input file has no PM column (function-rate and ICR). We join
        // by Project ID against the selected mapping source (MD run or
        // uploaded file). Runs BEFORE the name-based stages so
        // applyPreResolvedEmails and the directory resolver see a real
        // manager name instead of 'Unassigned'. Over-planning skips this
        // block entirely — its files already carry PMs.
        if (file.functionId === 'function-rate' || file.functionId === 'internal-cost-rate') {
          const idMap = await buildProjectIdToManagerMap(tx, process, file, body.mappingSource);
          resolvedProjectIdToManager = applyProjectIdToManager(result.issues, idMap);
        }
        const preMap = await buildMappingSourceMap(tx, process, file, body.mappingSource);
        resolvedFromMapping = applyPreResolvedEmails(result.issues, preMap);
      }

      // Master Data exports have no email column at all — every owner must
      // be looked up from the tenant's Manager Directory. For over-planning
      // we also prefer the directory: it's canonical, the workbook isn't.
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
        severity: severitySummary(issuesWithCodes),
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

    // After-commit realtime emissions. We deliberately do NOT emit inside the
    // transaction: a rollback would leave clients with events for state that
    // never landed in the DB.
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
}
