import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthGate } from './AuthGate';
import { PageHeaderProvider } from '../layout/PageHeaderContext';
import { useCurrentUser } from './authContext';

function AdminGate({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  if (user === null) return null;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function AdminRoute({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <PageHeaderProvider>
        <AdminGate>{children}</AdminGate>
      </PageHeaderProvider>
    </AuthGate>
  );
}
