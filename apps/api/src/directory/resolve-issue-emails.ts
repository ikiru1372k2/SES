import type { Prisma, PrismaClient } from '@prisma/client';
import { matchRawNameToDirectoryEntries } from './directory-matching';

type TxOrClient = Prisma.TransactionClient | PrismaClient;

interface IssueEmailInput {
  projectManager: string;
  email?: string | undefined;
}

export interface ResolveIssueEmailsOutcome<T extends IssueEmailInput> {
  issues: T[];
  resolvedFromDirectory: number;
  unresolvedManagerNames: string[];
}

/**
 * Look up each issue's project manager in the tenant's Manager Directory
 * and write the directory email onto the issue. This is the single point
 * where every function's audit pipeline gains a recipient — the engines
 * don't need to know about the directory.
 *
 * Resolution order for each issue.email:
 *   1. Matching directory entry (score ≥ DIRECTORY_RATIO_AUTO).
 *   2. Whatever the engine already set (e.g. over-planning files that
 *      carry a `Manager Email` column).
 *   3. Empty string — caller should surface a "missing email" chip in the
 *      UI and skip the entry on bulk send.
 */
export async function resolveIssueEmailsFromDirectory<T extends IssueEmailInput>(
  tx: TxOrClient,
  tenantId: string,
  issues: T[],
): Promise<ResolveIssueEmailsOutcome<T>> {
  const names = [
    ...new Set(issues.map((issue) => issue.projectManager?.trim()).filter((name): name is string => Boolean(name))),
  ];
  if (names.length === 0) {
    return { issues, resolvedFromDirectory: 0, unresolvedManagerNames: [] };
  }

  const entries = await tx.managerDirectory.findMany({
    where: { tenantId, active: true },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      normalizedKey: true,
      aliases: true,
      active: true,
    },
  });
  if (entries.length === 0) {
    return { issues, resolvedFromDirectory: 0, unresolvedManagerNames: names };
  }

  // Match once per unique name — engines can produce hundreds of issues
  // for the same manager; matching is O(entries) per call so cache it.
  const resolvedEmailByName = new Map<string, string>();
  const unresolved: string[] = [];
  for (const name of names) {
    const match = matchRawNameToDirectoryEntries(name, entries);
    if (match.autoMatch && !match.collision) {
      resolvedEmailByName.set(name, match.autoMatch.email);
    } else {
      unresolved.push(name);
    }
  }

  let resolvedFromDirectory = 0;
  for (const issue of issues) {
    const raw = issue.projectManager?.trim();
    if (!raw) continue;
    const directoryEmail = resolvedEmailByName.get(raw);
    if (directoryEmail) {
      issue.email = directoryEmail;
      resolvedFromDirectory += 1;
    }
  }

  return { issues, resolvedFromDirectory, unresolvedManagerNames: unresolved };
}
