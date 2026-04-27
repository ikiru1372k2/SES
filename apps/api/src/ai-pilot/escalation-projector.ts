import type { AuditIssue } from '@ses/domain';
import { PrismaService } from '../common/prisma.service';

export interface EscalationLitePreview {
  totalEscalations: number;
  uniqueManagers: number;
  perManagerCount: Array<{ email: string; displayName: string; count: number }>;
  unassignedCount: number;
}

/**
 * Compute the lite escalation preview from a sandbox AuditResult.
 * Read-only: never writes Escalation rows. Joins flagged rows' emails
 * against ManagerDirectory for the tenant to estimate per-manager load.
 */
export async function projectLiteEscalations(
  prisma: PrismaService,
  tenantId: string,
  issues: AuditIssue[],
): Promise<EscalationLitePreview> {
  const total = issues.length;
  if (total === 0) {
    return { totalEscalations: 0, uniqueManagers: 0, perManagerCount: [], unassignedCount: 0 };
  }

  const emailToCount = new Map<string, number>();
  let unassigned = 0;
  for (const issue of issues) {
    const email = (issue.email ?? '').trim().toLowerCase();
    if (!email) {
      unassigned += 1;
      continue;
    }
    emailToCount.set(email, (emailToCount.get(email) ?? 0) + 1);
  }

  const emails = [...emailToCount.keys()];
  if (emails.length === 0) {
    return {
      totalEscalations: total,
      uniqueManagers: 0,
      perManagerCount: [],
      unassignedCount: unassigned,
    };
  }

  const directory = await prisma.managerDirectory.findMany({
    where: { tenantId, active: true, email: { in: emails } },
    select: { email: true, firstName: true, lastName: true },
  });
  const emailToName = new Map(
    directory.map((m) => [m.email.toLowerCase(), `${m.firstName} ${m.lastName}`.trim()]),
  );

  const perManager = emails
    .map((email) => ({
      email,
      displayName: emailToName.get(email) ?? '(not in directory)',
      count: emailToCount.get(email) ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    totalEscalations: total,
    uniqueManagers: perManager.length,
    perManagerCount: perManager,
    unassignedCount: unassigned,
  };
}
