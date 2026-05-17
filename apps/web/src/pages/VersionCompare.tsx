import { useMemo } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import {
  DEFAULT_FUNCTION_ID,
  isFunctionId,
  type AuditIssue,
  type ComparisonResult,
  type FunctionId,
} from '@ses/domain';
import { processDashboardPath, workspacePath } from '../lib/processRoutes';
import { useAppStore } from '../store/useAppStore';
import { selectFunctionVersions } from '../lib/domain/versionScope';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { VersionCompareView } from '../components/version-compare/VersionCompareView';

export function VersionCompare() {
  const { processId: routeProcessId, id: legacyId, functionId: routeFunctionId } = useParams<{
    processId?: string;
    id?: string;
    functionId?: string;
  }>();
  const resolvedProcessId = routeProcessId ?? legacyId;
  const functionId: FunctionId =
    routeFunctionId && isFunctionId(routeFunctionId) ? routeFunctionId : DEFAULT_FUNCTION_ID;
  const process = useAppStore((state) =>
    resolvedProcessId
      ? state.processes.find((item) => item.id === resolvedProcessId || item.displayCode === resolvedProcessId)
      : undefined,
  );
  const navigate = useNavigate();

  // Versions are independent per function: only compare this function's
  // versions (scope files too so the per-file grouping/labels stay consistent).
  const scopedProcess = useMemo(
    () =>
      process
        ? {
            ...process,
            files: process.files.filter(
              (f) => (f.functionId ?? DEFAULT_FUNCTION_ID) === functionId,
            ),
            versions: selectFunctionVersions(process, functionId),
          }
        : process,
    [process, functionId],
  );

  const openEvidence = (issue: AuditIssue) => {
    if (!process) return;
    const key = issue.issueKey ?? issue.id;
    if (!key) return;
    const path = workspacePath(process.displayCode ?? process.id, functionId);
    void navigate(`${path}?tab=results&issue=${encodeURIComponent(key)}`);
  };

  const headerConfig = useMemo(
    () => ({
      breadcrumbs: process
        ? [
            { label: 'Dashboard', to: '/' },
            { label: process.name, to: processDashboardPath(process.displayCode ?? process.id) },
          ]
        : [],
      overflowActions: [
        {
          id: 'back-workspace',
          label: 'Back to workspace',
          icon: ArrowLeft,
          onClick: () => {
            if (process) void navigate(`${workspacePath(process.displayCode ?? process.id, functionId)}?tab=versions`);
          },
        },
      ],
    }),
    [process, functionId, navigate],
  );
  usePageHeader(headerConfig);

  if (!resolvedProcessId || !process) return <Navigate to="/" replace />;

  return (
    <AppShell process={process}>
      <div className="mx-auto w-full max-w-6xl px-5 py-6 sm:px-8">
        <p className="mb-4 text-sm text-ink-3">
          <Link
            to={`${workspacePath(process.displayCode ?? process.id, functionId)}?tab=versions`}
            className="text-brand hover:underline"
          >
            ← Back to Versions tab
          </Link>
        </p>
        <VersionCompareView process={scopedProcess ?? process} onOpenIssue={openEvidence} showTitle />
      </div>
    </AppShell>
  );
}

export type { ComparisonResult };
