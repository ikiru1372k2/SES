/**
 * Email/manager mapping helpers used by AuditRunnerService.
 * Extracted to keep the runner class under 400 lines.
 */
import { BadRequestException } from '@nestjs/common';
import type { AuditIssue } from '@ses/domain';
import { normalizeObservedManagerLabel } from '@ses/domain';
import type { PrismaService } from '../../common/prisma.service';
import type { MappingSourceDto } from '../../dto/audits.dto';

type TxClient = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

// Build a name → email map from either an uploaded mapping file or a completed master-data run.
export async function buildMappingSourceMap(
  tx: TxClient,
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

export function applyPreResolvedEmails(issues: AuditIssue[], map: Map<string, string>): number {
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

// ────────────────────────────────────────────────────────────────────────
// Function-rate specific: ownership resolution by Project ID.
//
// Over-planning files carry a Project Manager column, so the name-based
// mapping in buildMappingSourceMap works for them. Function-rate input
// files do not — they contain Project ID, Project Name, Employee Name,
// Function, but no PM. So every function-rate issue would land with
// projectManager='Unassigned' and directory resolution would fail.
//
// This pre-pass resolves PM name by joining the function-rate row's
// Project ID against the selected mapping source (a completed master-data
// audit run, or an uploaded file with Project ID + Project Manager
// columns). It runs BEFORE the existing name-based stages so that
// applyPreResolvedEmails and resolveIssueEmailsFromDirectory see a real
// manager name and resolve the email exactly as they do today.
//
// Gated by file.functionId === 'function-rate' at the call site — the
// over-planning mapping path is not touched.
// ────────────────────────────────────────────────────────────────────────
export async function buildProjectIdToManagerMap(
  tx: TxClient,
  process: { id: string; displayCode: string },
  auditFile: { id: string },
  src: MappingSourceDto,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const normKey = (v: unknown) => String(v ?? '').trim().toLowerCase();

  if (src.type === 'uploaded_file') {
    if (!src.uploadId) return map;
    // Same-file guard: audit file cannot also be its own mapping source.
    // Matches the guard already enforced in buildMappingSourceMap.
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
    if (rows.length < 2) return map;
    const headerRow = (rows[0] ?? []).map((c) => String(c ?? '').toLowerCase().trim());
    const idCol = headerRow.findIndex((h) =>
      ['project id', 'project no', 'project no.', 'project number', 'projectno'].includes(h),
    );
    const pmCol = headerRow.findIndex((h) =>
      ['project manager', 'manager', 'projectmanager'].includes(h),
    );
    if (idCol < 0 || pmCol < 0) return map;
    for (const row of rows.slice(1)) {
      const id = normKey((row as unknown[])[idCol]);
      const pm = String((row as unknown[])[pmCol] ?? '').trim();
      if (id && pm && !map.has(id)) map.set(id, pm);
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
      select: { projectNo: true, projectManager: true },
    });
    for (const issue of issues) {
      const id = normKey(issue.projectNo);
      const pm = String(issue.projectManager ?? '').trim();
      // First occurrence wins to keep the map deterministic when an MD run
      // has multiple issues per project (which is common).
      if (id && pm && !map.has(id)) map.set(id, pm);
    }
  }

  return map;
}

// Populate issue.projectManager for function-rate issues whose row carried
// no manager name. Key: normalized Project ID. Never overwrites an already-
// populated manager name — keeps this pre-pass additive and safe to re-run.
export function applyProjectIdToManager(issues: AuditIssue[], map: Map<string, string>): number {
  if (map.size === 0) return 0;
  let count = 0;
  for (const issue of issues) {
    const current = (issue.projectManager ?? '').trim();
    if (current && current.toLowerCase() !== 'unassigned') continue;
    const key = String(issue.projectNo ?? '').trim().toLowerCase();
    if (!key) continue;
    const pm = map.get(key);
    if (pm) {
      issue.projectManager = pm;
      count += 1;
    }
  }
  return count;
}
