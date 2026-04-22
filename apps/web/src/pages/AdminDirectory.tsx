import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { DirectoryTable } from '../components/directory/DirectoryTable';
import { DirectoryUploadWizard } from '../components/directory/DirectoryUploadWizard';
import { AppShell } from '../components/layout/AppShell';
import { Button } from '../components/shared/Button';
import { useCurrentUser } from '../components/auth/authContext';

export function AdminDirectory() {
  const user = useCurrentUser();
  const [wizard, setWizard] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  if (!user) return null;
  if (user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell>
      <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/" className="text-sm text-brand hover:underline">
              ← Dashboard
            </Link>
            <h1 className="mt-2 text-xl font-semibold">Manager directory</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Tenant-wide contacts for audit notifications ({user.tenantDisplayCode}).
            </p>
          </div>
          <Button type="button" onClick={() => setWizard(true)}>
            Import…
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-6xl p-6">
        <DirectoryTable refreshKey={refreshKey} />
      </div>
      {wizard ? (
        <DirectoryUploadWizard
          onClose={() => setWizard(false)}
          onDone={() => setRefreshKey((k) => k + 1)}
        />
      ) : null}
    </AppShell>
  );
}
