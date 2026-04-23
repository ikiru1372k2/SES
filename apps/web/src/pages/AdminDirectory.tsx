import { useCallback, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { DirectoryTable } from '../components/directory/DirectoryTable';
import { DirectoryUploadWizard } from '../components/directory/DirectoryUploadWizard';
import { AppShell } from '../components/layout/AppShell';
import { usePageHeader } from '../components/layout/usePageHeader';
import { Button } from '../components/shared/Button';
import { useCurrentUser } from '../components/auth/authContext';

export function AdminDirectory() {
  const user = useCurrentUser();
  const [wizard, setWizard] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const openWizard = useCallback(() => setWizard(true), []);

  const headerConfig = useMemo(
    () => ({
      breadcrumbs: [
        { label: 'Dashboard', to: '/' },
        { label: 'Manager directory' },
      ],
    }),
    [],
  );
  usePageHeader(headerConfig);

  if (!user) return null;
  if (user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Manager directory</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              Tenant-wide contacts for audit notifications ({user.tenantDisplayCode}).
            </p>
          </div>
          <Button type="button" onClick={openWizard}>
            Import…
          </Button>
        </div>
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
