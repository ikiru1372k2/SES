import { Injectable, Logger } from '@nestjs/common';
import {
  EscalationLevelResolver,
  isValidEmail,
  managerKey,
  normalizeObservedManagerLabel,
  type OccurrenceRecord,
} from '@ses/domain';
import { PrismaService } from '../../common/prisma.service';

/**
 * Resolves the level-wise escalation level (L1, L2, L3 …) for a flagged
 * (manager, issue) pair from the persisted audit-run history.
 *
 * History is *not* a new table — it already lives in `AuditRun` (one row per
 * audit, immutable, with a `findingsHash` content fingerprint) and
 * `AuditIssue` (the flagged rows: `issueKey`, `projectManager`, `email`).
 * The level is derived deterministically from that history, so it can never
 * double-increment and never resets on a new upload. See the domain module
 * `escalationLevels.ts` for the level definition.
 *
 * Manager identity is resolved the **same way the Escalation Center does**
 * (issue email when valid, else the tenant ManagerDirectory by normalized
 * name, else a missing-email bucket). This is what makes leveling work for
 * *every* function — not just Master Data: functions whose email is resolved
 * from a per-run mapping file (over-planning, function-rate, internal-cost-
 * rate) used to drift between an unresolved key on one run and an email key
 * on the next, so a repeat never matched. Folding in the directory the same
 * way the aggregator does gives a stable identity across runs.
 */
@Injectable()
export class EscalationLevelService {
  private readonly logger = new Logger(EscalationLevelService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds a resolver over every completed audit run for the process,
   * across all functions. Scoping by process (and, transitively, by the
   * issueKey which already encodes process + sheet + project + ruleCode) is
   * enough to keep different issues and audit domains separate.
   *
   * @param tenantId tenant whose ManagerDirectory is used to resolve a
   *   manager's email when a given run did not carry one (parity with
   *   EscalationsService directory enrichment).
   */
  async resolverForProcess(processId: string, tenantId: string): Promise<EscalationLevelResolver> {
    const [runs, directories] = await Promise.all([
      this.prisma.auditRun.findMany({
        where: {
          processId,
          OR: [{ status: 'completed' }, { completedAt: { not: null } }],
        },
        select: {
          findingsHash: true,
          issues: {
            select: {
              issueKey: true,
              projectManager: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.managerDirectory.findMany({
        where: { tenantId, active: true },
        select: { normalizedKey: true, email: true },
      }),
    ]);

    const directoryByKey = new Map(
      (directories as Array<{ normalizedKey: string; email: string }>).map((d) => [
        d.normalizedKey.trim().toLowerCase(),
        d.email.trim().toLowerCase(),
      ]),
    );

    const records: OccurrenceRecord[] = [];
    let unknownManagerCount = 0;
    let missingIssueKeyCount = 0;

    for (const run of runs as Array<{
      findingsHash: string | null;
      issues: Array<{ issueKey: string | null; projectManager: string | null; email: string | null }>;
    }>) {
      const findingsHash = run.findingsHash ?? '';
      for (const issue of run.issues) {
        if (!issue.issueKey) {
          missingIssueKeyCount += 1;
          continue;
        }
        const name = issue.projectManager?.trim() || 'Unknown';
        if (name === 'Unknown' || name === 'Unassigned') unknownManagerCount += 1;
        // Effective email == the escalation aggregator's: the issue's own
        // email when valid, else the directory by normalized manager name.
        // Keeps identity stable across runs even when only some runs
        // carried a resolved email (mapping-based functions).
        const effectiveEmail = isValidEmail(issue.email)
          ? issue.email
          : directoryByKey.get(normalizeObservedManagerLabel(name).toLowerCase()) ?? null;
        const mKey = managerKey(name, effectiveEmail);
        records.push({ findingsHash, managerKey: mKey, issueKey: issue.issueKey });
      }
    }

    if (unknownManagerCount > 0 || missingIssueKeyCount > 0) {
      this.logger.warn(
        `Escalation level history for process ${processId}: ` +
          `${unknownManagerCount} issue(s) with unknown/unassigned manager (bucketed, default L1), ` +
          `${missingIssueKeyCount} issue(s) without an issueKey (skipped, default L1).`,
      );
    }

    return new EscalationLevelResolver(records);
  }
}
