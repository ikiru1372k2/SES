import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { bucketedProcesses } from '../lib/scheduleHelpers';
import { CreateProcessModal } from '../components/dashboard/CreateProcessModal';
import { AuditSchedule } from '../components/dashboard/AuditSchedule';
import { ProcessCard } from '../components/dashboard/ProcessCard';
import { AppShell } from '../components/layout/AppShell';
import { BrandMark } from '../components/shared/BrandMark';
import { Button } from '../components/shared/Button';
import { EmptyState } from '../components/shared/EmptyState';
import { useAppStore } from '../store/useAppStore';

export function Dashboard() {
  const processes = useAppStore((state) => state.processes);
  const hydrateProcesses = useAppStore((state) => state.hydrateProcesses);
  const [showCreate, setShowCreate] = useState(false);
  const didHydrate = useRef(false);
  useEffect(() => {
    if (didHydrate.current) return;
    didHydrate.current = true;
    hydrateProcesses();
  }, [hydrateProcesses]);
  useEffect(() => {
    const overdue = bucketedProcesses(processes).overdue.length;
    document.title = overdue ? `(${overdue}) SES - Audit Overdue` : 'SES - Smart Escalation System';
  }, [processes]);

  return (
    <AppShell>
      <div className="p-6">
        <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="border-l-4 border-brand p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <BrandMark />
                <h1 className="mt-5 text-2xl font-bold">Smart Escalation System</h1>
                <p className="mt-2 max-w-3xl text-sm text-gray-600 dark:text-gray-300">Audit effort planning, identify overplanning or no-planning risks, prepare manager notifications, and track escalation progress in one controlled workspace.</p>
              </div>
              <Button onClick={() => setShowCreate(true)} leading={<Plus size={16} />}>Create New Process</Button>
            </div>
          </div>
        </div>
        <AuditSchedule processes={processes} />
        {processes.length ? (
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {processes.map((process) => <ProcessCard key={process.id} process={process} />)}
          </div>
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
