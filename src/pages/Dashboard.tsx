import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { CreateProcessModal } from '../components/dashboard/CreateProcessModal';
import { ProcessCard } from '../components/dashboard/ProcessCard';
import { AppShell } from '../components/layout/AppShell';
import { BrandMark } from '../components/shared/BrandMark';
import { EmptyState } from '../components/shared/EmptyState';
import { useAppStore } from '../store/useAppStore';

export function Dashboard() {
  const processes = useAppStore((state) => state.processes);
  const hydrateProcesses = useAppStore((state) => state.hydrateProcesses);
  const [showCreate, setShowCreate] = useState(false);
  useEffect(() => {
    if (!processes.length) hydrateProcesses();
  }, [hydrateProcesses, processes.length]);

  return (
    <AppShell>
      <div className="p-6">
        <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="border-l-4 border-[#b00020] p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <BrandMark />
                <h1 className="mt-5 text-2xl font-bold">Smart Escalation System</h1>
                <p className="mt-2 max-w-3xl text-sm text-gray-600 dark:text-gray-300">Audit effort planning, identify overplanning or no-planning risks, prepare manager notifications, and track escalation progress in one controlled workspace.</p>
              </div>
              <button onClick={() => setShowCreate(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#b00020] px-4 py-2 text-sm font-medium text-white hover:bg-[#8f001a]"><Plus size={16} /> Create New Process</button>
            </div>
          </div>
        </div>
        {processes.length ? (
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {processes.map((process) => <ProcessCard key={process.id} process={process} />)}
          </div>
        ) : (
          <EmptyState title="No audit processes yet" action={<button onClick={() => setShowCreate(true)} className="rounded-lg bg-[#b00020] px-4 py-2 text-sm font-medium text-white">Create your first audit process</button>}>
            Start with a process for May, June, or any audit cycle you need to track.
          </EmptyState>
        )}
      </div>
      {showCreate ? <CreateProcessModal onClose={() => setShowCreate(false)} /> : null}
    </AppShell>
  );
}
