import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { bucketedProcesses } from '../lib/scheduleHelpers';
import { CreateProcessModal } from '../components/dashboard/CreateProcessModal';
import { AuditSchedule } from '../components/dashboard/AuditSchedule';
import { ProcessCard } from '../components/dashboard/ProcessCard';
import { AppShell } from '../components/layout/AppShell';
import { BrandMark } from '../components/shared/BrandMark';
import { Button } from '../components/shared/Button';
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
    const filtered = processes.filter((process) => `${process.name} ${process.description}`.toLowerCase().includes(query));
    return [...filtered].sort((a, b) => {
      if (sort === 'alphabetical') return a.name.localeCompare(b.name);
      if (sort === 'overdue') return String(a.nextAuditDue ?? '9999').localeCompare(String(b.nextAuditDue ?? '9999'));
      return new Date(b.createdAt ?? b.updatedAt).getTime() - new Date(a.createdAt ?? a.updatedAt).getTime();
    });
  }, [processes, search, sort]);

  return (
    <AppShell>
      <div className="p-6">
        <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="border-l border-brand/20 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <BrandMark />
                <h1 className="mt-5 text-2xl font-bold">Smart Escalation System</h1>
                <p className="mt-2 max-w-3xl text-sm text-gray-600 dark:text-gray-300">Audit effort planning, identify overplanning or no-planning risks, prepare manager notifications, and track escalation progress in one controlled workspace.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {user?.role === 'admin' ? (
                  <Link
                    to="/admin/directory"
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:border-brand hover:text-brand dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-900"
                  >
                    Manager directory
                  </Link>
                ) : null}
                <Button onClick={() => setShowCreate(true)} leading={<Plus size={16} />}>Create New Process</Button>
              </div>
            </div>
          </div>
        </div>
        <AuditSchedule processes={processes} />
        {hydrating ? (
          <DashboardSkeleton />
        ) : processes.length ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search processes..." className="min-w-64 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" />
              <select value={sort} onChange={(event) => setSort(parseSort(event.target.value))} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900">
                <option value="recent">Newest first</option>
                <option value="alphabetical">Alphabetical</option>
                <option value="overdue">Most overdue</option>
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {visibleProcesses.map((process) => <ProcessCard key={process.id} process={process} />)}
            </div>
          </>
        ) : (
          <EmptyState title="No audit processes yet" action={<Button onClick={() => setShowCreate(true)}>Create your first audit process</Button>}>
            Start with a process for May, June, or any audit cycle you need to track.
          </EmptyState>
        )}
      </div>
      {showCreate ? <CreateProcessModal onClose={() => setShowCreate(false)} /> : null}
    </AppShell>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-6 h-16 w-full" />
          <Skeleton className="mt-5 h-9 w-32" />
        </div>
      ))}
    </div>
  );
}
