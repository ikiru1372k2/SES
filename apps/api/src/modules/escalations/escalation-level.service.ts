import { Injectable, Logger } from '@nestjs/common';
import {
  EscalationLevelResolver,
  managerKey,
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
 */
@Injectable()
export class EscalationLevelService {
  private readonly logger = new Logger(EscalationLevelService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds a resolver over every completed audit run for the process.
   * Scoping by process (and, transitively, by the issueKey which already
   * encodes process + sheet + project + ruleCode) is enough to keep
   * different issues and audit domains separate.
   */
  async resolverForProcess(processId: string): Promise<EscalationLevelResolver> {
    const runs = await this.prisma.auditRun.findMany({
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
    });

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
        // Same identity the escalation aggregator uses (managerKey of the
        // manager name + email): email when valid, else a missing-email
        // bucket keyed by the normalized name.
        const mKey = managerKey(name, issue.email);
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
