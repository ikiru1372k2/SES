import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, GitCompare, Plus, Search, Sparkles, Users } from 'lucide-react';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { bucketedProcesses } from '../lib/domain/scheduleHelpers';
import { CreateProcessModal } from '../components/dashboard/CreateProcessModal';
import { AuditSchedule } from '../components/dashboard/AuditSchedule';
import { ProcessCard } from '../components/dashboard/ProcessCard';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { Button } from '../components/shared/Button';
import { PageHeader } from '../components/shared/PageHeader';
import { WelcomeModal as AiPilotWelcomeModal } from '../components/ai-pilot/WelcomeModal';
import { EmptyState } from '../components/shared/EmptyState';
import { Skeleton } from '../components/shared/Skeleton';
import { useCurrentUser } from '../components/auth/authContext';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

type SortKey = 'recent' | 'alphabetical' | 'overdue';
const VALID_SORTS: readonly SortKey[] = ['recent', 'alphabetical', 'overdue'];
function parseSort(value: string | null): SortKey {
  return VALID_SORTS.includes(value as SortKey) ? (value as SortKey) : 'recent';
}

const toolbarControlClass =
  'rounded-lg border border-rule bg-white text-sm text-ink shadow-soft outline-none transition-all ease-soft focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

export function Dashboard() {
  const user = useCurrentUser();
  const processes = useAppStore((state) => state.processes);
  const hydrateProcesses = useAppStore((state) => state.hydrateProcesses);
  const [showCreate, setShowCreate] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') ?? '';
  const sort: SortKey = parseSort(searchParams.get('sort'));
  const setSearch = useCallback(
    (value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set('q', value);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const setSort = useCallback(
    (value: SortKey) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === 'recent') next.delete('sort');
          else next.set('sort', value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [hydrating, setHydrating] = useState(true);
  const didHydrate = useRef(false);
  useKeyboardShortcut('n', () => setShowCreate(true), !showCreate);

  const headerConfig = useMemo(() => ({ breadcrumbs: [] }), []);
  usePageHeader(headerConfig);

  useEffect(() => {
    if (didHydrate.current) return;
    didHydrate.current = true;
    void hydrateProcesses().finally(() => setHydrating(false));
  }, [hydrateProcesses]);

  useEffect(() => {
    const overdue = bucketedProcesses(processes).overdue.length;
    document.title = overdue ? `(${overdue}) SES - Audit Overdue` : 'SES - Smart Escalation System';
  }, [processes]);

  const visibleProcesses = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = processes.filter((process) =>
      `${process.name} ${process.description}`.toLowerCase().includes(query),
    );
    return [...filtered].sort((a, b) => {
      if (sort === 'alphabetical') return a.name.localeCompare(b.name);
      if (sort === 'overdue') return String(a.nextAuditDue ?? '9999').localeCompare(String(b.nextAuditDue ?? '9999'));
      return new Date(b.createdAt ?? b.updatedAt).getTime() - new Date(a.createdAt ?? a.updatedAt).getTime();
    });
  }, [processes, search, sort]);

  const secondaryLinkClass =
    'inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-800 shadow-soft transition-all ease-soft hover:border-brand hover:text-brand hover:shadow-soft-md active:scale-[0.98] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PageHeader
          title="Smart Escalation System"
          description="Plan audits, surface overplanning and no-planning risks, prepare manager notifications, and track escalation progress in one workspace."
          className="mb-5 sm:mb-6"
          actions={
            <>
              <Link to="/compare" className={secondaryLinkClass}>
                <GitCompare size={14} aria-hidden />
                Compare
              </Link>
              {user?.role === 'admin' ? (
                <>
                  <Link to="/admin/directory" className={secondaryLinkClass}>
                    <Users size={14} aria-hidden />
                    Directory
                  </Link>
                  <Link to="/admin/templates" className={secondaryLinkClass}>
                    <FileText size={14} aria-hidden />
                    Templates
                  </Link>
                  <Link
                    to="/admin/ai-pilot"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand/40 bg-brand-subtle px-3 text-sm font-medium text-brand shadow-soft transition-all ease-soft hover:border-brand hover:bg-brand hover:text-white hover:shadow-soft-md active:scale-[0.98]"
                  >
                    <Sparkles size={14} aria-hidden />
                    AI Pilot
                  </Link>
                </>
              ) : null}
              <Button onClick={() => setShowCreate(true)} size="sm" leading={<Plus size={14} />}>
                Create new process
              </Button>
            </>
          }
        />

        <AuditSchedule processes={processes} />

        {hydrating ? (
          <DashboardSkeleton />
        ) : processes.length ? (
          <>
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-rule bg-white p-3 shadow-soft dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:p-3.5">
              <label className="relative min-w-0 flex-1 sm:max-w-[380px]">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
                  aria-hidden
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search processes…"
                  className={`${toolbarControlClass} w-full py-2 pl-9 pr-3`}
                />
              </label>
              <select
                value={sort}
                onChange={(event) => setSort(parseSort(event.target.value))}
                aria-label="Sort processes"
                className={`${toolbarControlClass} w-full py-2 pl-3 pr-8 sm:w-40`}
              >
                <option value="recent">Newest first</option>
                <option value="alphabetical">Alphabetical</option>
                <option value="overdue">Most overdue</option>
              </select>
              <p className="text-xs text-ink-3 sm:ml-auto">
                Showing {visibleProcesses.length} of {processes.length}
              </p>
            </div>

            {visibleProcesses.length > 0 ? (
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                {visibleProcesses.map((process) => (
                  <ProcessCard key={process.id} process={process} />
                ))}
              </div>
            ) : (
              <EmptyState title="No matching processes">
                Try a different search term or clear the filter.
              </EmptyState>
            )}
          </>
        ) : (
          <EmptyState
            title="No audit processes yet"
            action={<Button onClick={() => setShowCreate(true)}>Create your first audit process</Button>}
          >
            Start with a process for May, June, or any audit cycle you need to track.
          </EmptyState>
        )}
      </div>
      {showCreate ? <CreateProcessModal onClose={() => setShowCreate(false)} /> : null}
      <AiPilotWelcomeModal />
    </AppShell>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="mb-5 h-14 animate-pulse rounded-xl border border-rule bg-white dark:border-gray-800 dark:bg-gray-900" />
      <div className="mb-4 flex gap-3">
        <Skeleton className="h-10 flex-1 max-w-sm" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="rounded-xl border border-rule bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="mt-2 h-3 w-16" />
            <Skeleton className="mt-4 h-10 w-full" />
            <Skeleton className="mt-5 h-8 w-full" />
          </div>
        ))}
      </div>
    </>
  );
}
